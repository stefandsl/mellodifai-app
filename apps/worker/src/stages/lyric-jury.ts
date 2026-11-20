// Lyric pipeline helpers: a fast router picks the tone and the writer, and a jury of
// models scores each draft. Every call is best effort: a router or judge that fails is
// left out, so a provider outage slows nothing down and never blocks a song.

import { join } from "node:path";
import { workerPaths } from "../paths.js";
import { isCapRefusal } from "../providers/ledger.js";
import {
  type OpenRouterCall as Call,
  openRouterPost as post,
} from "../providers/openrouter.js";
export const JEV = "typesafe/jev-1.14";

export type Writer = "strong" | "fast";
export const DEFAULT_WRITERS: Record<Writer, string> = {
  strong: "anthropic/claude-opus-5.5",
  fast: "anthropic/claude-sonnet-5.5",
};
export const DEFAULT_JUDGES = [
  JEV,
  "anthropic/claude-haiku-5.5",
  "google/gemini-3.8-flash",
];
export const PASS_SCORE = 0.7;

// The daily cap of writer calls (LYRICS_DAILY_CAP, default 50), shared by the song drafts and the
// create panel's AI lyric buttons. Each call is reserved before it is made, also when it then
// fails in transit.
export async function lyricsBudget(
  secrets: Readonly<Record<string, string | undefined>>,
) {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const cap = Number(secrets.LYRICS_DAILY_CAP ?? "50");
  const stateFile =
    secrets.LYRICS_STATE_FILE ?? join(workerPaths().stateDir, "lyrics.json");
  const today = new Date().toISOString().slice(0, 10);
  let state: { day?: string; count?: number } = {};
  try {
    state = JSON.parse(await readFile(stateFile, "utf8")) as typeof state;
  } catch {}
  let count = state.day === today ? (state.count ?? 0) : 0;
  if (count >= cap) throw new Error("daily lyrics cap reached");
  return {
    async reserve() {
      if (count >= cap) throw new Error("daily lyrics cap reached");
      count += 1;
      await mkdir(dirname(stateFile), { recursive: true });
      await writeFile(stateFile, JSON.stringify({ day: today, count }));
    },
  };
}

// An OpenRouter privacy guardrail can replace words with tags like [PERSON_NAME] before a
// model sees them (seen live 2026-11-01: "la macchinetta" became [PERSON_NAME]).
export const REDACTION_NOTE =
  "Tags such as [PERSON_NAME], [ADDRESS] or [LOCATION] may appear in place of ordinary words: a privacy filter inserted them. They are not part of the song. Do not reproduce them, do not judge them, and infer the intended meaning from context.";
const REDACTED =
  /\[(?:PERSON_NAME|ADDRESS|EMAIL(?:_ADDRESS)?|PHONE(?:_NUMBER)?|LOCATION|ORGANIZATION|DATE_TIME|URL|IP_ADDRESS)\]/u;
export function looksRedacted(...texts: string[]): boolean {
  return texts.some((text) => REDACTED.test(text));
}

export const CRITERIA = {
  topic:
    "The lyrics are really about the requested topic, not about something else.",
  language:
    "The lyrics are natural, correct and idiomatic in the requested language, with no clumsy or machine-translated lines.",
  singable:
    "Lines have a steady meter, comparable syllable counts within a section and are easy to sing.",
  chorus: "The chorus is catchy, memorable and repeatable.",
  original:
    "The lyrics do not reuse the title, phrases, characters or story of the reference song.",
} as const;
export type Criterion = keyof typeof CRITERIA;
const CRITERION_KEYS = Object.keys(CRITERIA) as Criterion[];

const TONES = {
  ironic:
    "Ironic, satirical or comic song that plays with everyday situations.",
  romantic: "Love song, tender or passionate.",
  melancholic: "Sad, nostalgic or reflective song.",
  party: "Dance or party song meant to get people moving.",
  committed: "Song with a message about society, work or a cause.",
  story: "Song that tells a story with characters and a plot.",
} as const;

type Answer = {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  noul?: number;
};
function answers(json: unknown): Record<string, Answer> {
  const value = (json as { answers?: unknown })?.answers;
  return value && typeof value === "object"
    ? (value as Record<string, Answer>)
    : {};
}

export type Route = {
  tone: keyof typeof TONES | null;
  writer: Writer;
  confidence: number;
  ms: number;
  error?: string;
};

// Jev reads the request and decides how the song should be written and by whom.
export async function route(
  request: { topic: string; brief: string; style: string; lang: string },
  call: Call,
): Promise<Route> {
  const started = performance.now();
  try {
    const result = answers(
      await post(
        "decisions",
        {
          model: JEV,
          state: {
            song_request: request.topic,
            user_lyrics: request.brief.slice(0, 1500),
            style: request.style,
            language: request.lang,
          },
          questions: {
            tone: {
              type: "choice",
              instructions: "What kind of song does the user want?",
              criteria: TONES,
            },
            writer: {
              type: "choice",
              instructions: "Which writer does this song need?",
              criteria: {
                strong:
                  "Needs irony, wordplay, original imagery, a story with twists, or careful nuance in the language.",
                fast: "A simple, direct song that a fast writer handles well.",
              },
            },
          },
        },
        call,
        10_000,
      ),
    );
    const tone = result.tone?.choice;
    const writer = result.writer?.choice;
    const confidence = Number(result.writer?.confidence ?? 0);
    return {
      tone: tone && tone in TONES ? (tone as keyof typeof TONES) : null,
      // When unsure, the strong writer is the safe choice.
      writer: writer === "fast" && confidence >= 0.6 ? "fast" : "strong",
      confidence,
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    if (isCapRefusal(error)) throw error;
    return {
      tone: null,
      writer: "strong",
      confidence: 0,
      ms: Math.round(performance.now() - started),
      error: String(error instanceof Error ? error.message : error),
    };
  }
}

export function toneLine(tone: Route["tone"]): string {
  return tone ? `Tone: ${TONES[tone]}` : "";
}

export type Verdict = {
  model: string;
  ms: number;
  scores?: Record<Criterion, number>;
  issues?: string[];
  improver?: Writer;
  error?: string;
};

type Draft = { title: string; lyrics: string; style: string };
type Context = {
  topic: string;
  lang: string;
  referenceTitle: string;
  // The user's free-text brief: its explicit requirements (register, a second language in the
  // chorus, accent) override the defaults.
  brief?: string;
  // The reference song's lyrics: the draft must not copy or paraphrase them.
  referenceLyrics?: string;
};

function clamp(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : undefined;
}

function complete(
  raw: Record<string, unknown>,
): Record<Criterion, number> | undefined {
  const scores = {} as Record<Criterion, number>;
  for (const key of CRITERION_KEYS) {
    const value = clamp(raw[key]);
    if (value === undefined) return undefined;
    scores[key] = value;
  }
  return scores;
}

async function jevVerdict(
  draft: Draft,
  context: Context,
  call: Call,
): Promise<Omit<Verdict, "model" | "ms">> {
  const questions: Record<string, unknown> = Object.fromEntries(
    CRITERION_KEYS.map((key) => [
      key,
      {
        type: "noul",
        instructions: CRITERIA[key],
        criteria: {
          true: CRITERIA[key],
          false: "It does not meet this standard.",
        },
      },
    ]),
  );
  questions.improver = {
    type: "choice",
    instructions: "If this draft needs work, which writer should improve it?",
    criteria: {
      strong:
        "It needs deeper rewriting: imagery, wordplay, story or language.",
      fast: "It needs only small fixes.",
    },
  };
  const result = answers(
    await post(
      "decisions",
      {
        model: JEV,
        state: {
          requested_topic: context.topic,
          language: context.lang,
          reference_title: context.referenceTitle,
          note: REDACTION_NOTE,
          title: draft.title,
          lyrics: draft.lyrics.slice(0, 6000),
        },
        questions,
      },
      call,
      10_000,
    ),
  );
  const scores = complete(
    Object.fromEntries(CRITERION_KEYS.map((key) => [key, result[key]?.noul])),
  );
  if (!scores) throw new Error("incomplete Jev verdict");
  return {
    scores,
    improver: result.improver?.choice === "fast" ? "fast" : "strong",
  };
}

const JUDGE_INSTRUCTIONS = [
  REDACTION_NOTE,
  'You are a strict judge of song lyrics. Rate the draft on each criterion with "yes" (fully met), "partly" or "no":',
  ...CRITERION_KEYS.map((key) => `"${key}": ${CRITERIA[key]}`),
  'Reply with one JSON object: {"lyrics_language": the English name of the language most lines are written in, "scores": {criterion: "yes" | "partly" | "no"}, "issues": [short concrete problems, quoting the line], "improver": "strong" or "fast"}.',
  'Use "strong" when the draft needs deep rewriting, "fast" when small fixes are enough.',
  'When the request includes a user\'s brief, also add "brief_followed": "yes" or "no". Answer "no" when the lyrics break an explicit requirement of the brief: its register or tone, an accent the rhymes must work in, or which languages are allowed or forbidden.',
].join("\n");

// Small judges rate in words more reliably than in decimals; numbers still count as given.
const RATING: Record<string, number> = { yes: 1, partly: 0.5, no: 0 };
function ratings(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      typeof value === "string" && value.trim().toLowerCase() in RATING
        ? RATING[value.trim().toLowerCase()]
        : value,
    ]),
  );
}

function parseJson(content: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/u, "")
        .replace(/\s*```$/u, ""),
    );
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// The English name of a language code ("ko" -> "Korean"), or undefined when unknown.
function languageName(code: string): string | undefined {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

// The letters a language is written in; every other language uses the Latin alphabet.
const SCRIPTS: Record<string, RegExp> = {
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh: /\p{Script=Han}/u,
  ko: /[\p{Script=Hangul}\p{Script=Han}]/u,
  ru: /\p{Script=Cyrillic}/u,
  uk: /\p{Script=Cyrillic}/u,
  bg: /\p{Script=Cyrillic}/u,
  el: /\p{Script=Greek}/u,
  ar: /\p{Script=Arabic}/u,
  he: /\p{Script=Hebrew}/u,
  hi: /\p{Script=Devanagari}/u,
};

// Share of the sung letters (section tags left out) written in the language's script; 1 when
// there are no letters.
function scriptShare(lyrics: string, lang: string): number {
  const script =
    SCRIPTS[lang.toLowerCase().split("-")[0] ?? ""] ?? /\p{Script=Latin}/u;
  const letters = lyrics.replace(/\[[^\]]*\]/gu, "").match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 1;
  return letters.filter((c) => script.test(c)).length / letters.length;
}

// Lower case letters and digits only, one space between words.
function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// The distinct sung lines of a lyric, letters and digits only, lower case.
function sungLines(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/u)
        .filter((line) => line.trim() && !line.trim().startsWith("["))
        .map((line) => line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""))
        .filter((line) => line.length >= 4),
    ),
  ];
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const gram = text.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

// Dice similarity of the character bigrams of two lines (0 to 1); works in every script.
function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  let shared = 0;
  let total = 0;
  for (const [gram, count] of ga) {
    shared += Math.min(count, gb.get(gram) ?? 0);
    total += count;
  }
  for (const count of gb.values()) total += count;
  return total ? (2 * shared) / total : 0;
}

// Share of the draft's distinct lines that are a close copy (similarity 0.6 or more) of a
// reference line. A paraphrase that swaps a third of the words stays above 0.8; a new lyric on
// the same theme stays near 0.
export function copiedShare(lyrics: string, referenceLyrics: string): number {
  const reference = sungLines(referenceLyrics);
  const draft = sungLines(lyrics);
  if (reference.length === 0 || draft.length === 0) return 0;
  return (
    draft.filter((line) => reference.some((r) => similarity(line, r) >= 0.6))
      .length / draft.length
  );
}

async function chatVerdict(
  model: string,
  draft: Draft,
  context: Context,
  call: Call,
): Promise<Omit<Verdict, "model" | "ms">> {
  const json = (await post(
    "chat",
    {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_INSTRUCTIONS },
        {
          role: "user",
          content: `Requested topic: ${context.topic}\nLanguage: ${languageName(context.lang) ?? context.lang}\n${context.brief ? `User's brief (its explicit requirements override the defaults, for example a register, an accent, or a second language allowed or forbidden): ${context.brief}\n` : ""}Reference song title (must not be reused): ${context.referenceTitle}\n${context.referenceLyrics ? `Reference song lyrics (the draft must not copy or paraphrase their lines):\n${context.referenceLyrics.slice(0, 4000)}\n` : ""}Title: ${draft.title}\nStyle: ${draft.style}\nLyrics:\n${draft.lyrics}`,
        },
      ],
    },
    call,
    25_000,
  )) as { choices?: { message?: { content?: string } }[] };
  const reply = parseJson(json.choices?.[0]?.message?.content ?? "");
  const scores = complete(ratings(reply.scores));
  if (!scores) throw new Error("incomplete verdict");
  const issues = Array.isArray(reply.issues)
    ? reply.issues.filter((i): i is string => typeof i === "string")
    : [];
  // A draft that breaks an explicit requirement of the user's brief misses the request.
  if (context.brief && reply.brief_followed === "no") {
    scores.topic = 0;
    issues.unshift("The lyrics break an explicit requirement of the brief.");
  }
  // The judge names the language it reads; a mismatch fails the language criterion outright.
  const wanted = languageName(context.lang);
  const seen =
    typeof reply.lyrics_language === "string" ? reply.lyrics_language : "";
  if (wanted && seen && !seen.toLowerCase().includes(wanted.toLowerCase())) {
    scores.language = 0;
    issues.unshift(`The lyrics are in ${seen}, not ${wanted}.`);
  }
  // Judges echo the requested language; the writing system cannot lie.
  if (scriptShare(draft.lyrics, context.lang) < 0.5) {
    scores.language = 0;
    issues.unshift(
      `The lyrics are not written in the script of ${wanted ?? context.lang}.`,
    );
  }
  // Judges miss a reused reference title; a plain text match does not.
  const reference = words(context.referenceTitle);
  if (
    reference.length > 3 &&
    ` ${words(draft.title)} ${words(draft.lyrics)} `.includes(` ${reference} `)
  ) {
    scores.original = 0;
    issues.unshift(
      `The draft reuses the reference title "${context.referenceTitle}".`,
    );
  }
  // Judges miss a close paraphrase of the reference lyrics; line similarity does not.
  if (
    context.referenceLyrics &&
    copiedShare(draft.lyrics, context.referenceLyrics) >= 0.3
  ) {
    scores.original = 0;
    issues.unshift("The draft paraphrases the reference song line by line.");
  }
  return {
    scores,
    issues,
    improver: reply.improver === "fast" ? "fast" : "strong",
  };
}

export type JuryReport = {
  available: boolean;
  passed: boolean;
  scores: Partial<Record<Criterion, number>>;
  failing: Criterion[];
  issues: string[];
  improver: Writer;
  verdicts: Verdict[];
  ms: number;
  // A judge saw privacy-filter tags instead of words, so its scores may be unfair.
  redacted: boolean;
};

// Judges vote in parallel; a criterion passes when its mean score reaches the threshold.
export function combine(
  verdicts: Verdict[],
  ms: number,
  passScore = PASS_SCORE,
): JuryReport {
  const valid = verdicts.filter(
    (v): v is Verdict & { scores: Record<Criterion, number> } =>
      v.scores !== undefined,
  );
  if (valid.length === 0)
    return {
      available: false,
      passed: true,
      scores: {},
      failing: [],
      issues: [],
      improver: "strong",
      verdicts,
      ms,
      redacted: false,
    };
  const scores = Object.fromEntries(
    CRITERION_KEYS.map((key) => [
      key,
      Math.round(
        (valid.reduce((sum, v) => sum + v.scores[key], 0) / valid.length) * 100,
      ) / 100,
    ]),
  ) as Record<Criterion, number>;
  const failing = CRITERION_KEYS.filter((key) => scores[key] < passScore);
  const strongVotes = valid.filter((v) => v.improver !== "fast").length;
  return {
    available: true,
    passed: failing.length === 0,
    scores,
    failing,
    issues: [...new Set(valid.flatMap((v) => v.issues ?? []))].slice(0, 10),
    improver: strongVotes * 2 >= valid.length ? "strong" : "fast",
    verdicts,
    ms,
    redacted: looksRedacted(...valid.flatMap((v) => v.issues ?? [])),
  };
}

export async function judge(
  draft: Draft,
  context: Context,
  judges: string[],
  call: Call,
  passScore = PASS_SCORE,
): Promise<JuryReport> {
  const started = performance.now();
  const verdicts = await Promise.all(
    judges.map(async (model): Promise<Verdict> => {
      const t0 = performance.now();
      try {
        const verdict =
          model === JEV
            ? await jevVerdict(draft, context, call)
            : await chatVerdict(model, draft, context, call);
        return { model, ms: Math.round(performance.now() - t0), ...verdict };
      } catch (error) {
        if (isCapRefusal(error)) throw error;
        return {
          model,
          ms: Math.round(performance.now() - t0),
          error: String(error instanceof Error ? error.message : error),
        };
      }
    }),
  );
  return combine(verdicts, Math.round(performance.now() - started), passScore);
}

export function revisionBrief(report: JuryReport): string {
  return [
    "The jury rejected the previous draft. Rewrite the whole JSON object, keeping the exact format, and fix:",
    ...report.failing.map(
      (key) =>
        `- ${key} (score ${report.scores[key]} < ${PASS_SCORE}): ${CRITERIA[key]}`,
    ),
    ...(report.issues.length ? ["Specific problems:", ...report.issues] : []),
  ].join("\n");
}
