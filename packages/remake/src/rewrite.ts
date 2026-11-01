// R3: new lyrics that carry each section's meaning map in new words, fitted to the
// original line timing, checked for originality line by line, then judged by a jury of
// models plus a devil's advocate, in rounds until they pass or a cap stops them.

import { type Client, DEFAULT_MODELS, JEV, type Models } from "./openrouter.js";
import {
  checkOriginality,
  DEFAULT_THRESHOLDS,
  type OriginalityReport,
  type Thresholds,
} from "./originality.js";
import {
  type AnalysedLine,
  type Analysis,
  JURY_CRITERIA,
  type JuryCriterion,
  type JuryRound,
  type RewriteResult,
  RewriteResultSchema,
  type Verdict,
} from "./schemas.js";
import { sanitizeTags } from "./style.js";
import { baseLang, countSyllables, fitLine, lineEnding } from "./syllables.js";

export type RewriteOptions = {
  lang: string;
  country?: string | null;
  writer?: "strong" | "fast";
  models?: Partial<Models>;
  maxRounds?: number;
  maxLineFixes?: number;
  thresholds?: Thresholds;
  passScore?: number;
  costCapUsd?: number;
  log?: (line: string) => void;
};

export const LANGUAGE_NAMES: Record<string, string> = {
  it: "Italian",
  en: "English",
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  ro: "Romanian",
  ru: "Russian",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
};
const languageName = (lang: string) => LANGUAGE_NAMES[baseLang(lang)] ?? lang;

const CRITERIA = Object.keys(JURY_CRITERIA) as JuryCriterion[];

type Draft = { title: string; sections: { id: string; lines: string[] }[] };

const OWNER_RULE =
  "The new song keeps the timing, structure and mood of the original. The lyrics transmit the same meaning and vibe, never the exact words: no copied phrase, no literal translation of a source line, no title, character, brand or artist name from the source. It must be safe for YouTube copyright and advertiser friendly.";

function lineBrief(line: AnalysedLine): string {
  const syllables =
    line.syllables.min === line.syllables.max
      ? `${line.syllables.min}`
      : `${line.syllables.min}-${line.syllables.max}`;
  return `${line.index}. [${syllables} syllables, final syllable ${line.ending}, ${(line.end - line.start).toFixed(1)} s] source: "${line.text}"`;
}

function sectionBriefs(analysis: Analysis): string {
  return analysis.music.sections
    .map((section) => {
      const lines = analysis.lines.filter((l) => l.sectionId === section.id);
      if (lines.length === 0)
        return `## ${section.id} (${section.label}): no vocals`;
      const m = analysis.meaning.find((x) => x.sectionId === section.id);
      const meaning = m
        ? `theme: ${m.theme}; story beat: ${m.storyBeat}; imagery: ${m.imagery.join(", ")}; emotional arc: ${m.emotionalArc}${m.hookIdea ? `; hook idea: ${m.hookIdea}` : ""}`
        : "no meaning map";
      return [
        `## ${section.id} (${section.label}, energy ${section.energy})`,
        `meaning: ${meaning}`,
        ...lines.map(lineBrief),
      ].join("\n");
    })
    .join("\n\n");
}

function lyricSections(analysis: Analysis) {
  return analysis.music.sections
    .map((s) => ({
      id: s.id,
      lines: analysis.lines.filter((l) => l.sectionId === s.id),
    }))
    .filter((s) => s.lines.length > 0);
}

function draftProblems(draft: Draft, analysis: Analysis): string[] {
  const problems: string[] = [];
  if (!draft || typeof draft.title !== "string" || !draft.title.trim())
    problems.push("missing title");
  for (const s of lyricSections(analysis)) {
    const got = draft?.sections?.find((x) => x?.id === s.id);
    if (!got) problems.push(`section ${s.id} is missing`);
    else if (!Array.isArray(got.lines) || got.lines.length !== s.lines.length)
      problems.push(
        `section ${s.id} must have exactly ${s.lines.length} lines (got ${got.lines?.length ?? 0})`,
      );
    else if (got.lines.some((l) => typeof l !== "string" || !l.trim()))
      problems.push(`section ${s.id} has an empty line`);
  }
  return problems;
}

function writerSystem(options: RewriteOptions): string {
  const lang = languageName(options.lang);
  return [
    "ROLE: lyric writer for a remake.",
    OWNER_RULE,
    `Write in natural, idiomatic, singable ${lang}${options.country ? `, culturally adapted for an audience in ${options.country} (local references, idioms and imagery, same meaning)` : ""}.`,
    "For every source line write exactly one new line that sings on the same notes: match the given syllable count (count sung syllables, vowel merges across words included) and make the final syllable stressed or unstressed as given.",
    "Carry each section's meaning map (theme, story beat, imagery, emotional arc, hook idea) in new images and words. Repeated source lines (a chorus) may repeat your new line the same way.",
    "Invent a new title that is not a translation of the source title.",
    'Reply with JSON only: {"title": string, "sections": [{"id": section id, "lines": [one string per source line, in order]}]}.',
  ].join("\n");
}

function writerUser(analysis: Analysis, options: RewriteOptions): string {
  return [
    `Target language: ${languageName(options.lang)}${options.country ? ` (country: ${options.country})` : ""}`,
    `Source language: ${languageName(analysis.sourceLanguage)}`,
    `Source title (do not reuse or translate): ${analysis.title}`,
    `Song: ${analysis.overall.summary}`,
    `Genre: ${analysis.overall.genre.join(", ")}; mood: ${analysis.overall.mood.join(", ")}; ${Math.round(analysis.music.bpm)} BPM, ${analysis.music.key.tonic} ${analysis.music.key.mode}`,
    "",
    sectionBriefs(analysis),
  ].join("\n");
}

type LineState = {
  line: AnalysedLine;
  sectionId: string;
  text: string;
};

function flatten(draft: Draft, analysis: Analysis): LineState[] {
  return lyricSections(analysis).flatMap((s) => {
    const got = draft.sections.find((x) => x.id === s.id);
    return s.lines.map((line, i) => ({
      line,
      sectionId: s.id,
      text: (got?.lines[i] ?? "").trim(),
    }));
  });
}

function fitOf(state: LineState, lang: string) {
  const syllables = countSyllables(state.text, lang);
  const ending = lineEnding(state.text, lang);
  return {
    syllables,
    ending,
    ...fitLine(
      { ...state.line.syllables, ending: state.line.ending },
      { ...syllables, ending },
    ),
  };
}

function judgeSystem(): string {
  return [
    "ROLE: judge of remake lyrics.",
    "Tags such as [PERSON_NAME] or [LOCATION] would come from a privacy filter: if you see one, list it as an issue quoting it.",
    OWNER_RULE,
    "Score the new lyrics from 0 to 1 on each criterion:",
    ...CRITERIA.map((key) => `"${key}": ${JURY_CRITERIA[key]}`),
    'Reply with one JSON object: {"scores": {criterion: number}, "issues": [short concrete problems, quoting the new line]}.',
  ].join("\n");
}

function devilSystem(): string {
  return [
    "ROLE: devil's advocate.",
    OWNER_RULE,
    "Argue why these lyrics should NOT be released. Be specific and quote lines.",
    "A blocker is a concrete problem that must be fixed before release: a line copied, closely paraphrased or literally translated from a source line, an artist, song or brand name, content unsafe for YouTube, a line that cannot be sung in its slot, broken grammar. Anything else is an objection.",
    'Reply with JSON only: {"blockers": [string], "objections": [string]}. Use an empty blockers list when nothing must be fixed.',
  ].join("\n");
}

function reviewUser(
  states: LineState[],
  analysis: Analysis,
  options: RewriteOptions,
  title: string,
): string {
  const rows = states.map((s) => {
    const fit = fitOf(s, options.lang);
    const target =
      s.line.syllables.min === s.line.syllables.max
        ? `${s.line.syllables.min}`
        : `${s.line.syllables.min}-${s.line.syllables.max}`;
    return `${s.line.index}. [${s.sectionId}] "${s.text}" (target ${target} syllables, final ${s.line.ending}; counted ${fit.syllables.min}-${fit.syllables.max}, final ${fit.ending}) | source: "${s.line.text}"`;
  });
  const meaning = analysis.meaning
    .map(
      (m) => `${m.sectionId}: ${m.theme} / ${m.storyBeat} / ${m.emotionalArc}`,
    )
    .join("\n");
  return [
    `Language: ${languageName(options.lang)}${options.country ? `, adapted for ${options.country}` : ""}`,
    `Source title: ${analysis.title}`,
    `New title: ${title}`,
    "Meaning map per section:",
    meaning,
    "New lines (with their source line):",
    ...rows,
  ].join("\n");
}

function clamp(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : undefined;
}

function completeScores(
  raw: unknown,
): Record<JuryCriterion, number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const scores = {} as Record<JuryCriterion, number>;
  for (const key of CRITERIA) {
    const v = clamp((raw as Record<string, unknown>)[key]);
    if (v === undefined) return undefined;
    scores[key] = v;
  }
  return scores;
}

async function jevVerdict(
  client: Client,
  text: string,
): Promise<Omit<Verdict, "model" | "ms">> {
  const json = (await client.decide(
    {
      model: JEV,
      state: { task: OWNER_RULE, lyrics_review: text.slice(0, 7000) },
      questions: Object.fromEntries(
        CRITERIA.map((key) => [
          key,
          {
            type: "noul",
            instructions: JURY_CRITERIA[key],
            criteria: {
              true: JURY_CRITERIA[key],
              false: "It does not meet this standard.",
            },
          },
        ]),
      ),
    },
    "jury:jev",
  )) as { answers?: Record<string, { noul?: number }> };
  const scores = completeScores(
    Object.fromEntries(CRITERIA.map((key) => [key, json.answers?.[key]?.noul])),
  );
  if (!scores) throw new Error("incomplete Jev verdict");
  return { scores, issues: [] };
}

async function runJury(
  client: Client,
  models: Models,
  user: string,
  round: number,
  passScore: number,
  flagged: number,
): Promise<JuryRound> {
  const verdicts = await Promise.all(
    models.judges.map(async (model): Promise<Verdict> => {
      const t0 = performance.now();
      try {
        if (model === JEV)
          return {
            model,
            ms: Math.round(performance.now() - t0),
            ...(await jevVerdict(client, user)),
          };
        const reply = await client.chatJson<{
          scores?: unknown;
          issues?: unknown;
        }>({
          step: `jury:${model}`,
          model,
          system: judgeSystem(),
          user,
          temperature: 0.2,
          maxTokens: 900,
        });
        const scores = completeScores(reply.scores);
        if (!scores) throw new Error("incomplete verdict");
        const issues = Array.isArray(reply.issues)
          ? reply.issues.filter((i): i is string => typeof i === "string")
          : [];
        return {
          model,
          ms: Math.round(performance.now() - t0),
          scores,
          issues,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "RedactionError")
          throw error;
        return {
          model,
          ms: Math.round(performance.now() - t0),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  let devil: JuryRound["devil"] = {
    model: models.devil,
    blockers: [],
    objections: [],
  };
  try {
    const reply = await client.chatJson<{
      blockers?: unknown;
      objections?: unknown;
    }>({
      step: "jury:devil",
      model: models.devil,
      system: devilSystem(),
      user,
      temperature: 0.4,
      maxTokens: 900,
    });
    const strings = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
        : [];
    devil = {
      model: models.devil,
      blockers: strings(reply.blockers).slice(0, 8),
      objections: strings(reply.objections).slice(0, 8),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "RedactionError") throw error;
    devil = {
      model: models.devil,
      blockers: [],
      objections: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const valid = verdicts.filter(
    (v): v is Verdict & { scores: Record<JuryCriterion, number> } =>
      v.scores !== undefined,
  );
  const scores: JuryRound["scores"] = {};
  for (const key of CRITERIA)
    if (valid.length)
      scores[key] =
        Math.round(
          (valid.reduce((sum, v) => sum + v.scores[key], 0) / valid.length) *
            100,
        ) / 100;
  const failing = valid.length
    ? CRITERIA.filter((key) => (scores[key] ?? 0) < passScore)
    : [...CRITERIA];
  const issues = [...new Set(valid.flatMap((v) => v.issues ?? []))].slice(
    0,
    12,
  );
  return {
    round,
    scores,
    failing,
    issues,
    devil,
    verdicts,
    passed:
      valid.length > 0 &&
      failing.length === 0 &&
      devil.blockers.length === 0 &&
      flagged === 0,
  };
}

export async function rewrite(
  analysis: Analysis,
  options: RewriteOptions,
  deps: { client: Client },
): Promise<RewriteResult> {
  const { client } = deps;
  const models: Models = { ...DEFAULT_MODELS, ...options.models };
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const passScore = options.passScore ?? 0.7;
  const maxRounds = options.maxRounds ?? 3;
  const maxLineFixes = options.maxLineFixes ?? 2;
  const costCap = options.costCapUsd ?? 0.1;
  const log = options.log ?? (() => {});
  const mark = client.ledger.calls.length;
  const spent = () => client.ledger.since(mark).usd + analysis.cost.usd;
  const writerModel =
    options.writer === "strong" ? models.writerStrong : models.writerFast;
  const sourceLines = analysis.lines.map((l) => l.text);
  if (sourceLines.length === 0)
    throw new Error(
      "the source has no sung lines to rewrite (instrumental, or no transcript)",
    );

  // A literal translation exists only to catch new lines that are too close to it.
  let translationLines: string[] | null = null;
  if (baseLang(options.lang) !== baseLang(analysis.sourceLanguage)) {
    const reply = await client.chatJson<{ lines?: unknown }>({
      step: "translate-literal",
      model: models.analyst,
      system: `ROLE: literal translator.\nTranslate each lyric line literally into ${languageName(options.lang)}, word for word where possible, one output line per input line. Reply with JSON only: {"lines": [string]}.`,
      user: sourceLines.map((l, i) => `${i}. ${l}`).join("\n"),
      temperature: 0,
      maxTokens: 2500,
    });
    const lines = Array.isArray(reply.lines) ? reply.lines.map(String) : [];
    translationLines = lines.length === sourceLines.length ? lines : null;
    if (!translationLines)
      log(
        "literal translation came back with the wrong line count; comparing against the source only",
      );
  }

  const embed = async (texts: string[]) =>
    client.embed(texts, models.embedding, "originality:embeddings");

  async function writeDraft(extra?: string): Promise<Draft> {
    let user = writerUser(analysis, options) + (extra ? `\n\n${extra}` : "");
    for (let attempt = 0; attempt < 3; attempt++) {
      const draft = await client.chatJson<Draft>({
        step: extra ? "revise" : "write",
        model: writerModel,
        system: writerSystem(options),
        user,
        maxTokens: 3000,
        temperature: 0.8,
      });
      const problems = draftProblems(draft, analysis);
      if (problems.length === 0) return draft;
      log(`draft shape problems: ${problems.join("; ")}`);
      user = `${writerUser(analysis, options)}${extra ? `\n\n${extra}` : ""}\n\nYour previous reply was rejected: ${problems.join("; ")}. Return the complete JSON again.`;
    }
    throw new Error(
      "the writer could not return the lyrics in the required shape",
    );
  }

  async function fixLines(
    states: LineState[],
    report: OriginalityReport,
  ): Promise<number> {
    const problems = states.flatMap((s, i) => {
      const fit = fitOf(s, options.lang);
      const o = report.lines[i];
      const why: string[] = [];
      if (!fit.fits)
        why.push(
          `it has ${fit.syllables.min}-${fit.syllables.max} sung syllables, the slot needs ${s.line.syllables.min}-${s.line.syllables.max} (${fit.delta > 0 ? "shorten" : "lengthen"} it)`,
        );
      if (o?.flagged) {
        const ref =
          o.against === "translation"
            ? translationLines?.[o.closestSource ?? -1]
            : sourceLines[o.closestSource ?? -1];
        why.push(
          `it is too close to the ${o.against === "translation" ? "literal translation" : "source"} line "${ref ?? ""}" (lexical ${o.lexical}, semantic ${o.semantic ?? "n/a"}, shared words in a row ${o.sharedRun}): say it with different images and words`,
        );
      }
      return why.length ? [{ i, s, why }] : [];
    });
    if (problems.length === 0) return 0;
    const reply = await client.chatJson<{
      lines?: { index?: unknown; text?: unknown }[];
    }>({
      step: "fix-lines",
      model: models.writerFast,
      system: [
        "ROLE: lyric line fixer.",
        OWNER_RULE,
        `Rewrite only the listed ${languageName(options.lang)} lines so each one fixes its problem while keeping its section's meaning and fitting with the lines around it.`,
        'Reply with JSON only: {"lines": [{"index": number, "text": string}]}.',
      ].join("\n"),
      user: [
        "Whole lyrics for context:",
        ...states.map((s) => `${s.line.index}. [${s.sectionId}] ${s.text}`),
        "",
        "Fix these lines:",
        ...problems.map(
          (p) =>
            `${p.s.line.index}. "${p.s.text}" (target ${p.s.line.syllables.min}-${p.s.line.syllables.max} syllables, final ${p.s.line.ending}): ${p.why.join("; ")}`,
        ),
      ].join("\n"),
      temperature: 0.8,
      maxTokens: 1500,
    });
    let changed = 0;
    for (const item of reply.lines ?? []) {
      const index = Number(item?.index);
      const text = typeof item?.text === "string" ? item.text.trim() : "";
      const state = states.find((s) => s.line.index === index);
      if (state && text && problems.some((p) => p.s === state)) {
        state.text = text;
        changed++;
      }
    }
    return changed;
  }

  let draft = await writeDraft();
  let states = flatten(draft, analysis);
  const rounds: JuryRound[] = [];
  let report = await checkOriginality({
    lines: states.map((s) => s.text),
    sourceLines,
    translationLines,
    lang: options.lang,
    sourceLang: analysis.sourceLanguage,
    thresholds,
    embed,
  });
  let stoppedBecause: RewriteResult["jury"]["stoppedBecause"] = "round-cap";

  for (let round = 1; round <= maxRounds; round++) {
    for (let fix = 0; fix < maxLineFixes && spent() < costCap; fix++) {
      const changed = await fixLines(states, report);
      if (changed === 0) break;
      report = await checkOriginality({
        lines: states.map((s) => s.text),
        sourceLines,
        translationLines,
        lang: options.lang,
        sourceLang: analysis.sourceLanguage,
        thresholds,
        embed,
      });
    }
    if (spent() >= costCap) {
      stoppedBecause = "cost-cap";
      break;
    }
    const jury = await runJury(
      client,
      models,
      reviewUser(states, analysis, options, draft.title),
      round,
      passScore,
      report.flaggedLines,
    );
    rounds.push(jury);
    log(
      `round ${round}: ${jury.passed ? "passed" : `failing ${jury.failing.join(", ") || "-"}, ${jury.devil.blockers.length} blockers, ${report.flaggedLines} flagged lines`}`,
    );
    if (jury.passed) {
      stoppedBecause = "passed";
      break;
    }
    if (!jury.verdicts.some((v) => v.scores)) {
      stoppedBecause = "no-jury";
      break;
    }
    if (round === maxRounds) break;
    if (spent() >= costCap) {
      stoppedBecause = "cost-cap";
      break;
    }
    const feedback = [
      "The jury rejected the previous version below. Rewrite the whole JSON, keeping what works, and fix:",
      ...jury.failing.map(
        (key) =>
          `- ${key} (score ${jury.scores[key as JuryCriterion]} < ${passScore}): ${JURY_CRITERIA[key as JuryCriterion]}`,
      ),
      ...jury.issues.map((i) => `- ${i}`),
      ...jury.devil.blockers.map((b) => `- must fix: ${b}`),
      "Previous version:",
      JSON.stringify({
        title: draft.title,
        sections: lyricSections(analysis).map((s) => ({
          id: s.id,
          lines: states.filter((x) => x.sectionId === s.id).map((x) => x.text),
        })),
      }),
    ].join("\n");
    draft = await writeDraft(feedback);
    states = flatten(draft, analysis);
    report = await checkOriginality({
      lines: states.map((s) => s.text),
      sourceLines,
      translationLines,
      lang: options.lang,
      sourceLang: analysis.sourceLanguage,
      thresholds,
      embed,
    });
  }

  const byIndex = new Map(
    states.map((s, i) => [s.line.index, { s, o: report.lines[i] }]),
  );
  const sections = analysis.music.sections.map((section) => ({
    id: section.id,
    kind: section.kind,
    label: section.label,
    lines: analysis.lines
      .filter((l) => l.sectionId === section.id)
      .map((line) => {
        const entry = byIndex.get(line.index);
        const state = entry?.s ?? {
          line,
          sectionId: section.id,
          text: line.text,
        };
        const fit = fitOf(state, options.lang);
        return {
          index: line.index,
          source: line.text,
          text: state.text,
          start: line.start,
          end: line.end,
          target: { ...line.syllables, ending: line.ending },
          syllables: fit.syllables,
          ending: fit.ending,
          fits: fit.fits,
          endingMatch: fit.endingMatch,
          originality: entry?.o ?? {
            lexical: 0,
            semantic: null,
            sharedRun: 0,
            closestSource: null,
            against: null,
            flagged: false,
            exempt: true,
          },
        };
      }),
  }));
  const lyricsText = sections
    .map((s) => [`[${s.label}]`, ...s.lines.map((l) => l.text)].join("\n"))
    .join("\n\n");
  const passed = rounds.at(-1)?.passed ?? false;
  return RewriteResultSchema.parse({
    schemaVersion: 1,
    lang: options.lang,
    country: options.country ?? null,
    title: draft.title.trim(),
    styleTags: sanitizeTags(analysis.styleTags, analysis.protectedNames),
    sections,
    lyricsText,
    originality: {
      thresholds,
      flaggedLines: report.flaggedLines,
      maxLexical: report.maxLexical,
      maxSemantic: report.maxSemantic,
      semanticAvailable: report.semanticAvailable,
      ...(report.semanticError ? { semanticError: report.semanticError } : {}),
    },
    jury: { passed, rounds, stoppedBecause },
    cost: client.ledger.since(mark),
  });
}
