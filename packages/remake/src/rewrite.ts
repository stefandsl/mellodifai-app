// R3 (master design 8.4): new lyrics per section in the target language that carry the
// meaning map in new words, each line within one sung syllable of its source line, then
// the originality gate (10.3) and the lyric jury with the devil's advocate (10.2). Up to
// 3 rounds; failing lines are rewritten, passing lines kept.
import {
  type AnalysedLine,
  DEVIL_BLOCKING,
  DEVIL_CATEGORIES,
  type DevilObjection,
  REMAKE_JURY_CRITERIA,
  REMAKE_JURY_KEYS,
  type RemakeAnalysis,
  type RemakeIssue,
  type RemakeJuryCriterion,
  type RemakeJuryRound,
  type RemakeLyrics,
  RemakeLyricsSchema,
  type RemakeVerdict,
} from "@mellodifai/shared";
import { type Client, DEFAULT_MODELS, JEV, type Models } from "./openrouter.js";
import {
  checkPhrases,
  checkSections,
  DEFAULT_THRESHOLDS,
  type Embed,
  type LineReport,
  scoreLines,
  type Thresholds,
} from "./originality.js";
import { sanitizeTags } from "./style.js";
import { baseLang, countSyllables, fitLine, lineEnding } from "./syllables.js";

export type RewriteOptions = {
  lang: string;
  country?: string | null;
  writer?: "strong" | "fast";
  models?: Partial<Models>;
  maxRounds?: number;
  thresholds?: Thresholds;
  passScore?: number;
  costCapUsd?: number;
  // Design 10.3 enforces the 0.55 section-meaning gate; "report" records it only.
  meaningGate?: "enforce" | "report";
  log?: (line: string) => void;
};

// The song's own title, without the artist and the video labels: artist names never
// go into a prompt (the account's privacy filter also turns them into tags).
export function songTitle(analysis: RemakeAnalysis): string {
  // Video titles read "Artist - Song (Official Video)": the song is the last part.
  const bare = analysis.title.replace(/[([][^)\]]*[)\]]/gu, "").trim();
  const parts = bare
    .split(/\s+[-|:]\s+/u)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.at(-1) || bare || analysis.title;
}

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

const OWNER_RULE =
  "The new song keeps the timing, structure and mood of the original. The lyrics transmit the same meaning and vibe, never the exact words: no copied phrase, no literal translation of a source line, no title, character, brand or artist name from the source. It must be safe for YouTube copyright and advertiser friendly.";

type Draft = { title: string; sections: { id: string; lines: string[] }[] };
type LineState = { line: AnalysedLine; sectionId: string; text: string };

const range = (s: { min: number; max: number }) =>
  s.min === s.max ? `${s.min}` : `${s.min}-${s.max}`;

function meaningText(analysis: RemakeAnalysis, sectionId: string): string {
  const m = analysis.meaning.find((x) => x.sectionId === sectionId);
  return m
    ? [m.theme, m.storyBeat, m.imagery.join(", "), m.emotionalArc, m.hookIdea]
        .filter(Boolean)
        .join(". ")
    : "";
}

function lyricSections(analysis: RemakeAnalysis) {
  return analysis.music.sections
    .map((s) => ({
      ...s,
      lines: analysis.lines.filter((l) => l.sectionId === s.id),
    }))
    .filter((s) => s.lines.length > 0);
}

function sectionBriefs(analysis: RemakeAnalysis): string {
  return analysis.music.sections
    .map((section) => {
      const lines = analysis.lines.filter((l) => l.sectionId === section.id);
      if (lines.length === 0)
        return `## ${section.id} (${section.label}): no vocals`;
      return [
        `## ${section.id} (${section.label}, energy ${section.energy})`,
        `meaning: ${meaningText(analysis, section.id) || "none"}`,
        ...lines.map(
          (l) =>
            `${l.index}. [${range(l.syllables)} syllables, final syllable ${l.ending}, ${(l.end - l.start).toFixed(1)} s] source: "${l.text}"`,
        ),
      ].join("\n");
    })
    .join("\n\n");
}

function draftProblems(draft: Draft, analysis: RemakeAnalysis): string[] {
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

export function writerSystem(options: RewriteOptions): string {
  return [
    "ROLE: lyric writer for a remake.",
    OWNER_RULE,
    `Write in natural, idiomatic, singable ${languageName(options.lang)}${options.country ? `, culturally adapted for an audience in ${options.country} (local references, idioms and imagery, same meaning)` : ""}.`,
    "For every source line write exactly one new line that sings on the same notes: its sung syllable count (vowel merges across words included) must be within one of the number given for that line.",
    "Carry each section's meaning (theme, story beat, imagery, emotional arc, hook idea) with new images and new words. Do not translate source lines: say the idea differently. Where the source repeats a line, you may repeat your new line.",
    "Invent a new title that is not a translation of the source title and shares no three words in a row with it or with the source hook.",
    'Reply with JSON only: {"title": string, "sections": [{"id": section id, "lines": [one string per source line, in order]}]}.',
  ].join("\n");
}

export function writerUser(
  analysis: RemakeAnalysis,
  options: RewriteOptions,
): string {
  return [
    `Target language: ${languageName(options.lang)}${options.country ? ` (country: ${options.country})` : ""}`,
    `Source language: ${languageName(analysis.sourceLanguage)}`,
    `Source title (do not reuse or translate): ${songTitle(analysis)}`,
    `Song: ${analysis.overall.summary}`,
    `Genre: ${analysis.overall.genre.join(", ")}; mood: ${analysis.overall.mood.join(", ")}; ${Math.round(analysis.music.bpm)} BPM, ${analysis.music.key.tonic} ${analysis.music.key.mode}`,
    "",
    sectionBriefs(analysis),
  ].join("\n");
}

function flatten(draft: Draft, analysis: RemakeAnalysis): LineState[] {
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

const lineOf = (v: unknown) =>
  Number.isInteger(Number(v)) && v !== null && v !== "" ? Number(v) : null;

function issuesOf(v: unknown): RemakeIssue[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): RemakeIssue[] => {
    if (typeof x === "string")
      return x.trim() ? [{ line: null, problem: x }] : [];
    if (x && typeof x === "object") {
      const o = x as { line?: unknown; problem?: unknown };
      return typeof o.problem === "string" && o.problem.trim()
        ? [{ line: lineOf(o.line), problem: o.problem }]
        : [];
    }
    return [];
  });
}

function objectionsOf(v: unknown): DevilObjection[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): DevilObjection[] => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) return [];
    const category = (DEVIL_CATEGORIES as readonly string[]).includes(
      String(o.category),
    )
      ? (o.category as DevilObjection["category"])
      : "other";
    return [
      {
        category,
        severity: o.severity === "must_fix" ? "must_fix" : "note",
        line: lineOf(o.line),
        text,
      },
    ];
  });
}

function clamp(value: unknown): number | undefined {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n)
    ? undefined
    : Math.min(1, Math.max(0, n));
}

function completeScores(
  raw: unknown,
): Record<RemakeJuryCriterion, number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const scores = {} as Record<RemakeJuryCriterion, number>;
  for (const key of REMAKE_JURY_KEYS) {
    const v = clamp((raw as Record<string, unknown>)[key]);
    if (v === undefined) return undefined;
    scores[key] = v;
  }
  return scores;
}

function judgeSystem(): string {
  return [
    "ROLE: judge of remake lyrics.",
    "Tags such as [PERSON_NAME] or [LOCATION] would come from a privacy filter: if you see one, report it as an issue quoting it.",
    OWNER_RULE,
    "Score the new lyrics from 0 to 1 on each criterion:",
    ...REMAKE_JURY_KEYS.map((key) => `"${key}": ${REMAKE_JURY_CRITERIA[key]}`),
    'Reply with one JSON object: {"scores": {criterion: number}, "issues": [{"line": line number or null, "problem": short concrete problem quoting the new line}]}.',
  ].join("\n");
}

function devilSystem(): string {
  return [
    "ROLE: devil's advocate.",
    OWNER_RULE,
    "Argue that these lyrics must NOT pass. Be specific and quote lines; at most 8 objections, one sentence each.",
    `Each objection has a category (${DEVIL_CATEGORIES.join(", ")}) and a severity: "must_fix" for a concrete problem that must be fixed before release (a line copied, closely paraphrased or literally translated from a source line; an artist, song or brand name; content unsafe for YouTube; a line in the wrong language), "note" for anything else.`,
    'Reply with JSON only: {"objections": [{"category": string, "severity": "must_fix" or "note", "line": line number or null, "text": string}]}.',
  ].join("\n");
}

function reviewUser(
  states: LineState[],
  analysis: RemakeAnalysis,
  options: RewriteOptions,
  title: string,
): string {
  const rows = states.map((s) => {
    const fit = fitOf(s, options.lang);
    return `${s.line.index}. [${s.sectionId}] "${s.text.toLowerCase()}" (target ${range(s.line.syllables)} syllables; counted ${range(fit.syllables)}) | source: "${s.line.text.toLowerCase()}"`;
  });
  return [
    `Target language: ${languageName(options.lang)}${options.country ? `, adapted for ${options.country}` : ""}`,
    `Source title: ${songTitle(analysis).toLowerCase()}`,
    `New title: ${title.toLowerCase()}`,
    "Lines are shown in lower case on purpose; do not judge capitalisation.",
    "Meaning map per section:",
    ...lyricSections(analysis).map(
      (s) => `${s.id}: ${meaningText(analysis, s.id)}`,
    ),
    "New lines (each with its source line):",
    ...rows,
  ].join("\n");
}

async function jevVerdict(
  client: Client,
  text: string,
): Promise<Omit<RemakeVerdict, "model" | "ms">> {
  const json = (await client.decide(
    {
      model: JEV,
      state: { task: OWNER_RULE, lyrics_review: text.slice(0, 7000) },
      questions: Object.fromEntries(
        REMAKE_JURY_KEYS.map((key) => [
          key,
          {
            type: "noul",
            instructions: REMAKE_JURY_CRITERIA[key],
            criteria: {
              true: REMAKE_JURY_CRITERIA[key],
              false: "It does not meet this standard.",
            },
          },
        ]),
      ),
    },
    "jury:jev",
  )) as { answers?: Record<string, { noul?: number }> };
  const scores = completeScores(
    Object.fromEntries(
      REMAKE_JURY_KEYS.map((key) => [key, json.answers?.[key]?.noul]),
    ),
  );
  if (!scores) throw new Error("incomplete Jev verdict");
  return { scores, issues: [] };
}

const REDACTED_INPUT =
  "OpenRouter's privacy filter replaced words of the lyrics with tags such as [PERSON_NAME] before this model read them";
const isRedaction = (error: unknown) =>
  error instanceof Error && error.name === "RedactionError";

async function runJury(
  client: Client,
  models: Models,
  user: string,
  round: number,
  passScore: number,
  gates: RemakeJuryRound["gates"],
): Promise<RemakeJuryRound> {
  const verdicts = await Promise.all(
    models.judges.map(async (model): Promise<RemakeVerdict> => {
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
          maxTokens: 2500,
        });
        const scores = completeScores(reply.scores);
        if (!scores) throw new Error("incomplete verdict");
        return {
          model,
          ms: Math.round(performance.now() - t0),
          scores,
          issues: issuesOf(reply.issues),
        };
      } catch (error) {
        // The filter altered what this judge read: its verdict is discarded (our lyrics
        // are intact; a writer reply with tags still fails the run).
        if (isRedaction(error))
          return {
            model,
            ms: Math.round(performance.now() - t0),
            error: `verdict discarded: ${REDACTED_INPUT}`,
          };
        return {
          model,
          ms: Math.round(performance.now() - t0),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  let devil: RemakeJuryRound["devil"];
  try {
    const reply = await client.chatJson<{ objections?: unknown }>({
      step: "jury:devil",
      model: models.devil,
      system: devilSystem(),
      user,
      temperature: 0.4,
      maxTokens: 1500,
    });
    const objections = objectionsOf(reply.objections).slice(0, 12);
    devil = {
      model: models.devil,
      objections,
      blocking: objections.filter(
        (o) => o.severity === "must_fix" && DEVIL_BLOCKING.includes(o.category),
      ).length,
    };
  } catch (error) {
    // Fail-closed: a devil's advocate that read altered lyrics cannot clear the draft.
    if (isRedaction(error))
      devil = {
        model: models.devil,
        objections: [
          {
            category: "safety",
            severity: "must_fix",
            line: null,
            text: REDACTED_INPUT,
          },
        ],
        blocking: 1,
        error: REDACTED_INPUT,
      };
    else
      devil = {
        model: models.devil,
        objections: [],
        blocking: 0,
        error: error instanceof Error ? error.message : String(error),
      };
  }
  const valid = verdicts.filter(
    (v): v is RemakeVerdict & { scores: Record<RemakeJuryCriterion, number> } =>
      v.scores !== undefined,
  );
  const scores: RemakeJuryRound["scores"] = {};
  for (const key of REMAKE_JURY_KEYS)
    if (valid.length)
      scores[key] =
        Math.round(
          (valid.reduce((sum, v) => sum + v.scores[key], 0) / valid.length) *
            100,
        ) / 100;
  const failing = valid.length
    ? REMAKE_JURY_KEYS.filter((key) => (scores[key] ?? 0) < passScore)
    : [...REMAKE_JURY_KEYS];
  const seen = new Set<string>();
  const issues = valid
    .flatMap((v) => v.issues ?? [])
    .filter((i) => !seen.has(i.problem) && Boolean(seen.add(i.problem)))
    .slice(0, 16);
  const gatesOk =
    gates.flaggedLines === 0 &&
    gates.misfitLines === 0 &&
    gates.phraseOk &&
    gates.sectionsOk;
  // Every member read the same text: if the privacy filter altered it for one, the whole
  // round judged altered lyrics, so no verdict of the round counts (fail-closed).
  const redacted =
    verdicts.some((v) => v.error?.includes(REDACTED_INPUT)) ||
    devil.error === REDACTED_INPUT;
  const available = valid.length > 0 && !redacted;
  if (redacted) issues.unshift({ line: null, problem: REDACTED_INPUT });
  return {
    round,
    available,
    scores,
    failing,
    issues,
    devil,
    verdicts,
    gates,
    passed:
      available && failing.length === 0 && devil.blocking === 0 && gatesOk,
  };
}

export async function rewrite(
  analysis: RemakeAnalysis,
  options: RewriteOptions,
  deps: { client: Client; embed: Embed; embedder: string },
): Promise<RemakeLyrics> {
  const { client, embed } = deps;
  const models: Models = { ...DEFAULT_MODELS, ...options.models };
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const passScore = options.passScore ?? 0.7;
  const maxRounds = options.maxRounds ?? 3;
  const costCap = options.costCapUsd ?? 0.1;
  const meaningGate = options.meaningGate ?? "enforce";
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

  // The literal translation exists only to catch new lines that are too close to it.
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
    const lines = Array.isArray(reply.lines)
      ? reply.lines.map((l) => String(l).replace(/^\d+\.\s*/u, ""))
      : [];
    if (lines.length !== sourceLines.length)
      throw new Error(
        `the literal translation came back with ${lines.length} lines for ${sourceLines.length}: the originality gate needs one per source line`,
      );
    translationLines = lines;
  }
  const hookIds = new Set(
    analysis.music.sections
      .filter((s) => s.kind === "chorus" || s.kind === "hook")
      .map((s) => s.id),
  );
  const sourceHook = analysis.lines.filter((l) => hookIds.has(l.sectionId));
  const phraseSources = [
    songTitle(analysis),
    ...sourceHook.map((l) => l.text),
    ...(translationLines
      ? sourceHook.map((l) => translationLines?.[l.index] ?? "")
      : []),
  ].filter(Boolean);

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

  type Gates = {
    lines: LineReport;
    phrase: ReturnType<typeof checkPhrases>;
    sections: Awaited<ReturnType<typeof checkSections>>;
    misfit: number;
  };
  async function gatesFor(states: LineState[], title: string): Promise<Gates> {
    const lines = await scoreLines({
      lines: states.map((s) => s.text),
      sourceLines,
      translationLines,
      embed,
      thresholds,
    });
    const phrase = checkPhrases({
      title,
      hookLines: states
        .filter((s) => hookIds.has(s.sectionId))
        .map((s) => s.text),
      sourceTexts: phraseSources,
      thresholds,
    });
    const sections = await checkSections({
      sections: lyricSections(analysis).map((s) => ({
        sectionId: s.id,
        text: states
          .filter((x) => x.sectionId === s.id)
          .map((x) => x.text)
          .join("\n"),
        source: s.lines.map((l) => l.text).join("\n"),
        meaning: meaningText(analysis, s.id),
      })),
      embed,
      thresholds,
    });
    return {
      lines,
      phrase,
      sections,
      misfit: states.filter((s) => !fitOf(s, options.lang).fits).length,
    };
  }

  type Target = { state: LineState; why: string[] };
  function gateTargets(states: LineState[], gates: Gates): Target[] {
    // Rewriting cannot reach a meaning score the source itself misses: only sections
    // whose source clears the threshold are sent back for rewriting.
    const failingSections = new Set(
      gates.sections
        .filter(
          (s) => !s.ok && (s.sourceCosine ?? 0) >= thresholds.sectionMeaning,
        )
        .map((s) => s.sectionId),
    );
    return states.flatMap((s, i): Target[] => {
      const why: string[] = [];
      const fit = fitOf(s, options.lang);
      if (!fit.fits)
        why.push(
          `it has ${range(fit.syllables)} sung syllables, the slot needs ${range(s.line.syllables)} (within one): ${fit.delta > 0 ? "shorten" : "lengthen"} it`,
        );
      const o = gates.lines.lines[i];
      if (o?.flagged) {
        const ref =
          o.against === "translation"
            ? translationLines?.[o.closestSource ?? -1]
            : sourceLines[o.closestSource ?? -1];
        why.push(
          `it is too close to the ${o.against === "translation" ? "literal translation" : "source"} line "${ref ?? ""}" (${o.reasons.join("; ")}): use different images and words`,
        );
      }
      if (failingSections.has(s.sectionId))
        why.push(
          `its section must carry its meaning more clearly (${analysis.meaning.find((m) => m.sectionId === s.sectionId)?.theme ?? ""})`,
        );
      if (
        !gates.phrase.ok &&
        hookIds.has(s.sectionId) &&
        gates.phrase.detail.includes(s.text)
      )
        why.push(`it reuses source words: ${gates.phrase.detail}`);
      return why.length ? [{ state: s, why }] : [];
    });
  }

  async function fixLines(
    states: LineState[],
    targets: Target[],
    title: string,
    retitle: string | null,
  ): Promise<string> {
    if (targets.length === 0 && !retitle) return title;
    const reply = await client.chatJson<{
      title?: unknown;
      lines?: { index?: unknown; text?: unknown }[];
    }>({
      step: "fix-lines",
      model: models.writerFast,
      system: [
        "ROLE: lyric line fixer.",
        OWNER_RULE,
        `Rewrite only the listed ${languageName(options.lang)} lines so each one fixes its problems, keeps its section's meaning and fits the lines around it; leave every other line as it is.`,
        'Reply with JSON only: {"title": new title or null, "lines": [{"index": number, "text": string}]}.',
      ].join("\n"),
      user: [
        `Title: ${title}${retitle ? ` (rewrite it: ${retitle})` : ""}`,
        "Whole lyrics for context:",
        ...states.map((s) => `${s.line.index}. [${s.sectionId}] ${s.text}`),
        "",
        "Fix these lines:",
        ...targets.map(
          (t) =>
            `${t.state.line.index}. "${t.state.text}" (target ${range(t.state.line.syllables)} syllables): ${t.why.join("; ")}`,
        ),
      ].join("\n"),
      temperature: 0.8,
      maxTokens: 1800,
    });
    for (const item of reply.lines ?? []) {
      const index = Number(item?.index);
      const text = typeof item?.text === "string" ? item.text.trim() : "";
      const target = targets.find((t) => t.state.line.index === index);
      if (target && text) target.state.text = text;
    }
    return retitle && typeof reply.title === "string" && reply.title.trim()
      ? reply.title.trim()
      : title;
  }

  let draft = await writeDraft();
  let title = draft.title.trim();
  const states = flatten(draft, analysis);
  const rounds: RemakeJuryRound[] = [];
  let gates = await gatesFor(states, title);
  let stoppedBecause: RemakeLyrics["jury"]["stoppedBecause"] = "round_cap";

  for (let round = 1; round <= maxRounds; round++) {
    // Deterministic gates first: targeted line fixes (two passes on the first draft).
    for (
      let pass = 0;
      pass < (round === 1 ? 2 : 1) && spent() < costCap;
      pass++
    ) {
      const targets = gateTargets(states, gates);
      const titleBad =
        !gates.phrase.ok && gates.phrase.detail.startsWith(`"${title}"`);
      if (targets.length === 0 && !titleBad) break;
      title = await fixLines(
        states,
        targets,
        title,
        titleBad ? gates.phrase.detail : null,
      );
      gates = await gatesFor(states, title);
    }
    if (spent() >= costCap) {
      stoppedBecause = "cost_cap";
      break;
    }
    const jury = await runJury(
      client,
      models,
      reviewUser(states, analysis, options, title),
      round,
      passScore,
      {
        flaggedLines: gates.lines.flaggedLines,
        misfitLines: gates.misfit,
        phraseOk: gates.phrase.ok,
        sectionsOk:
          meaningGate === "report" || gates.sections.every((s) => s.ok),
      },
    );
    rounds.push(jury);
    log(
      `round ${round}: ${jury.passed ? "passed" : `failing ${jury.failing.join(", ") || "-"}, ${jury.devil.blocking} blocking objections, ${gates.lines.flaggedLines} flagged and ${gates.misfit} misfit lines`}`,
    );
    if (jury.passed) {
      stoppedBecause = "passed";
      break;
    }
    // Design 10.1: a new jury is fail-closed.
    if (!jury.available) {
      stoppedBecause = "jury_unavailable";
      if (jury.issues.some((i) => i.problem === REDACTED_INPUT))
        log(
          `JURY UNAVAILABLE: ${REDACTED_INPUT}. The lyrics themselves are intact, but no judge can read them until the filter is switched off (OpenRouter settings, Privacy).`,
        );
      break;
    }
    if (round === maxRounds) break;
    if (spent() >= costCap) {
      stoppedBecause = "cost_cap";
      break;
    }
    // Rewrite the lines the jury, the devil and the gates named; keep the others.
    const named = new Map<number, string[]>();
    const add = (line: number | null, why: string) => {
      if (line === null || !states.some((s) => s.line.index === line))
        return false;
      named.set(line, [...(named.get(line) ?? []), why]);
      return true;
    };
    let unplaced = 0;
    for (const issue of jury.issues)
      if (!add(issue.line, issue.problem)) unplaced++;
    for (const o of jury.devil.objections)
      if (o.severity === "must_fix" && !add(o.line, `${o.category}: ${o.text}`))
        unplaced++;
    if (jury.failing.includes("chorus"))
      for (const s of states)
        if (hookIds.has(s.sectionId))
          add(s.line.index, "the chorus must be catchier and more memorable");
    for (const t of gateTargets(states, gates))
      for (const why of t.why) add(t.state.line.index, why);
    if (named.size === 0 && unplaced > 0) {
      // Nothing line-specific: a whole revision with the jury's notes.
      const feedback = [
        "The jury rejected the previous version below. Rewrite the whole JSON, keeping what works, and fix:",
        ...jury.failing.map(
          (key) =>
            `- ${key}: ${REMAKE_JURY_CRITERIA[key as RemakeJuryCriterion]}`,
        ),
        ...jury.issues.map((i) => `- ${i.problem}`),
        ...jury.devil.objections
          .filter((o) => o.severity === "must_fix")
          .map((o) => `- must fix: ${o.text}`),
        "Previous version:",
        JSON.stringify({
          title,
          sections: lyricSections(analysis).map((s) => ({
            id: s.id,
            lines: states
              .filter((x) => x.sectionId === s.id)
              .map((x) => x.text),
          })),
        }),
      ].join("\n");
      draft = await writeDraft(feedback);
      title = draft.title.trim();
      for (const [i, s] of flatten(draft, analysis).entries()) {
        const state = states[i];
        if (state) state.text = s.text;
      }
    } else {
      const targets = [...named].flatMap(([index, why]) => {
        const state = states.find((s) => s.line.index === index);
        return state ? [{ state, why }] : [];
      });
      title = await fixLines(states, targets, title, null);
    }
    gates = await gatesFor(states, title);
  }

  const byIndex = new Map(
    states.map((s, i) => [s.line.index, { s, o: gates.lines.lines[i] }]),
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
          originality: entry?.o ?? {
            jaccard4: 0,
            rougeL: 0,
            semantic: null,
            closestSource: null,
            against: null,
            flagged: false,
            reasons: [],
          },
        };
      }),
  }));
  const lyricsText = sections
    .map((s) => [`[${s.label}]`, ...s.lines.map((l) => l.text)].join("\n"))
    .join("\n\n");
  return RemakeLyricsSchema.parse({
    schemaVersion: 1,
    lang: options.lang,
    country: options.country ?? null,
    title,
    styleTags: sanitizeTags(analysis.styleTags, analysis.protectedNames),
    sections,
    lyricsText,
    originality: {
      thresholds,
      embedder: deps.embedder,
      flaggedLines: gates.lines.flaggedLines,
      maxLexical: gates.lines.maxLexical,
      maxSemantic: gates.lines.maxSemantic,
      phrase: gates.phrase,
      meaningGate,
      sections: gates.sections,
    },
    jury: { passed: stoppedBecause === "passed", rounds, stoppedBecause },
    cost: client.ledger.since(mark),
  });
}
