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
  'Reply with one JSON object: {"lyrics_language": the ISO 639-1 code of the language most lines are written in (for example "it", "ja", "en"), "scores": {criterion: "yes" | "partly" | "no"}, "issues": [short concrete problems, quoting the line], "improver": "strong" or "fast"}.',
  'Use "strong" when the draft needs deep rewriting, "fast" when small fixes are enough.',
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

function baseCode(lang: string): string {
  return lang.trim().toLowerCase().split(/[-_]/u)[0] ?? "";
}

// Languages a judge may name by an English or native name instead of a code.
const KNOWN_CODES =
  "it en es fr de pt ro ru ja ko zh uk bg el ar he hi pl nl sv tr cs hu fi da nb vi th id ca hr sr sk sl lt lv et ga fa ms tl sw".split(
    " ",
  );
const ALIASES: Record<string, string> = {
  mandarin: "zh",
  cantonese: "zh",
  putonghua: "zh",
  中文: "zh",
  普通话: "zh",
  castilian: "es",
  castellano: "es",
  farsi: "fa",
  norwegian: "nb",
  tagalog: "tl",
  filipino: "tl",
  moldovan: "ro",
};
let names: Map<string, string> | undefined;
function languageNames(): Map<string, string> {
  if (names) return names;
  names = new Map(Object.entries(ALIASES));
  for (const code of KNOWN_CODES)
    for (const locale of ["en", code]) {
      try {
        const name = new Intl.DisplayNames([locale], { type: "language" }).of(
          code,
        );
        if (name && name !== code) names.set(name.toLowerCase(), code);
      } catch {}
    }
  return names;
}

// The ISO 639-1 code of a judge's answer: a code ("it", "pt-BR") or a known name in English
// or in the language itself ("Italiano", "Mandarin", "Brazilian Portuguese"); undefined when
// the answer cannot be read, so an unreadable answer never fails a draft.
export function languageCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (/^[a-z]{2}(?:[-_][a-z0-9]+)*$/u.test(text)) return baseCode(text);
  const known = languageNames();
  const plain = text.replace(/\s*[(（][^)）]*[)）]\s*/gu, " ").trim();
  for (const candidate of [text, plain, ...plain.split(/[\s,/]+/u)]) {
    const code = known.get(candidate);
    if (code) return code;
  }
  return undefined;
}

// The letters a language is written in; every other language uses the Latin alphabet.
const SCRIPTS: Record<string, RegExp> = {
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh: /\p{Script=Han}/u,
  // Modern Korean lyrics use no hanja; Han letters in a Korean draft are Japanese or Chinese.
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  uk: /\p{Script=Cyrillic}/u,
  bg: /\p{Script=Cyrillic}/u,
  el: /\p{Script=Greek}/u,
  ar: /\p{Script=Arabic}/u,
  he: /\p{Script=Hebrew}/u,
  hi: /\p{Script=Devanagari}/u,
};

// The distinct sung lines of a lyric, section tags left out, trimmed.
function distinctLines(lyrics: string): string[] {
  return [
    ...new Set(
      lyrics
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("[")),
    ),
  ];
}

// Share of the distinct sung lines written in the language's script; 1 when there are none.
// A line counts when at least half of its words (runs of letters of one script) are in the
// script, so an English chorus or a loanword does not sink a Japanese or Korean song: the
// chorus counts once, however often it repeats.
function scriptShare(lyrics: string, lang: string): number {
  const script = SCRIPTS[baseCode(lang)] ?? /\p{Script=Latin}/u;
  const lines = distinctLines(lyrics).filter((line) => /\p{L}/u.test(line));
  if (lines.length === 0) return 1;
  const native = lines.filter((line) => {
    let inside = 0;
    let outside = 0;
    let previous: boolean | null = null;
    for (const c of line) {
      const current = /\p{L}/u.test(c) ? script.test(c) : null;
      if (current !== null && current !== previous)
        current ? inside++ : outside++;
      previous = current;
    }
    return inside >= outside;
  });
  return native.length / lines.length;
}

// Japanese written in Latin letters: most words split into romaji syllables.
const ROMAJI_WORD =
  /^(?:(?:[kgsztdnhbpmyrwfjv]|ch|sh|ts|[kgnhbpmr]y)?[aiueo]+|n(?![aiueo])|[kstpgdbcm](?=[kstpgdbcmj]))+$/u;
function isRomaji(lyrics: string): boolean {
  const latin = distinctLines(lyrics)
    .join(" ")
    .toLowerCase()
    .match(/\p{Script=Latin}+/gu);
  if (!latin || latin.length === 0) return false;
  return (
    latin.filter((word) => ROMAJI_WORD.test(word)).length / latin.length >= 0.7
  );
}
const KANA_DEMANDED =
  /kana|kanji|hiragana|katakana|仮名|かな|漢字|ひらがな|カタカナ/iu;

// Whether the brief names a language other than the requested one, in English, in the
// requested language or in its own ("inglese", "英語", "English"): such a brief allows or
// forbids a second language, and only the judges can tell which.
function briefNamesOtherLanguage(brief: string, lang: string): boolean {
  const text = brief.toLowerCase();
  if (!text.trim()) return false;
  const wanted = baseCode(lang);
  for (const code of KNOWN_CODES) {
    if (code === wanted) continue;
    for (const locale of ["en", wanted, code]) {
      let name: string | undefined;
      try {
        name = new Intl.DisplayNames([locale], { type: "language" })
          .of(code)
          ?.toLowerCase();
      } catch {}
      if (!name || name === code) continue;
      // Inflected languages change the ending ("inglés", "на английском").
      const stem = name.length >= 7 ? name.slice(0, -2) : name;
      const spaced =
        /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u.test(stem);
      if (
        spaced
          ? new RegExp(`(?<!\\p{L})${escapeRegExp(stem)}`, "u").test(text)
          : text.includes(stem)
      )
        return true;
    }
  }
  return false;
}
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// Lower case letters and digits only, one space between words.
function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Approximate syllables of a sung line: vowel groups, kana morae, two per Han character, one
// per Hangul block. Rough, but enough to spot a line twice as long as its neighbours.
const SMALL_KANA = "ゃゅょぁぃぅぇぉャュョァィゥェォ";
function syllables(line: string): number {
  const text = line.toLowerCase();
  const kana = (
    text.match(/[\p{Script=Hiragana}\p{Script=Katakana}ー]/gu) ?? []
  ).filter((c) => !SMALL_KANA.includes(c)).length;
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length * 2;
  const hangul = (text.match(/\p{Script=Hangul}/gu) ?? []).length;
  const vowels = (
    text.match(/[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýăœаеёиоуыэюяіїє]+/gu) ?? []
  ).length;
  return kana + han + hangul + vowels;
}

// Lines of this many syllables or fewer are shouts or ad-libs, not melody lines.
const SHORT_LINE = 3;

const CHORUS_TAG = /chorus|refrain|hook|ritornello|refren|estribillo|サビ/iu;

// Distinct chorus lines that are at least twice as long as their section's median line and at
// least 6 syllables longer: one melody cannot carry them.
export function overlongChorusLines(lyrics: string): string[] {
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const raw of lyrics.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      current = CHORUS_TAG.test(line) ? [] : null;
      if (current) sections.push(current);
    } else if (line && current) current.push(line);
  }
  const long = new Set<string>();
  for (const section of sections) {
    // Shouts and ad-libs ("Hey!", "Oh oh") are not melody lines: they would drag the median
    // down and make every real line look twice as long.
    const lines = section.filter((line) => syllables(line) > SHORT_LINE);
    if (lines.length < 3) continue;
    const counts = lines.map(syllables);
    const sorted = [...counts].sort((a, b) => a - b);
    const median = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
    lines.forEach((line, i) => {
      const n = counts[i] ?? 0;
      if (n >= 2 * median && n >= median + 6) long.add(line);
    });
  }
  return [...long];
}

// The distinct sung lines of a lyric, letters and digits only, lower case.
function sungLines(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/u)
        .filter((line) => line.trim() && !line.trim().startsWith("["))
        // A shared "Oh oh oh" or "Yeah yeah" is not a copied line.
        .filter((line) => syllables(line) > SHORT_LINE)
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
  // The judge names the language it reads. One judge can misread, so its mismatch counts as
  // "partly": it fails a single-judge jury but not a jury whose other judges agree.
  const wanted = languageName(context.lang);
  const seen = languageCode(reply.lyrics_language);
  if (seen && seen !== baseCode(context.lang)) {
    scores.language = Math.min(scores.language, RATING.partly ?? 0.5);
    issues.unshift(
      `The lyrics are in ${languageName(seen) ?? seen}, not ${wanted ?? context.lang}.`,
    );
  }
  // Judges echo the requested language; the writing system cannot lie. A brief that names a
  // second language is left to the judges, who read it.
  if (
    !briefNamesOtherLanguage(context.brief ?? "", context.lang) &&
    scriptShare(draft.lyrics, context.lang) < 0.5
  ) {
    const lenient =
      baseCode(context.lang) === "ja" &&
      isRomaji(draft.lyrics) &&
      !KANA_DEMANDED.test(context.brief ?? "");
    scores.language = Math.min(
      scores.language,
      lenient ? (RATING.partly ?? 0.5) : 0,
    );
    issues.unshift(
      lenient
        ? "The lyrics are Japanese in romaji, not in kana and kanji."
        : `The lyrics are not written in the script of ${wanted ?? context.lang}.`,
    );
  }
  // Judges miss a reused reference title; a plain text match does not.
  // The engine's title.txt ends in a tag such as "(VBP)" that no lyric repeats, so it goes.
  const referenceTitle = context.referenceTitle
    .trim()
    .replace(/\s*[(（][^()（）]*[)）]$/u, "")
    .trim();
  const reference = words(referenceTitle);
  const sung = ` ${words(draft.title)} ${words(draft.lyrics)} `;
  // Japanese and Chinese put no spaces between words: match them without word bounds.
  const unspaced =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(reference);
  if (
    reference.length > 3 &&
    (unspaced
      ? sung.replace(/ /gu, "").includes(reference.replace(/ /gu, ""))
      : sung.includes(` ${reference} `))
  ) {
    scores.original = 0;
    issues.unshift(`The draft reuses the reference title "${referenceTitle}".`);
  }
  // Judges miss two chorus lines that overflow the melody; a syllable count does not.
  const overlong = overlongChorusLines(draft.lyrics);
  if (overlong.length >= 2) {
    scores.singable = 0;
    issues.unshift(
      `These chorus lines are about twice as long as the others: "${overlong.slice(0, 2).join('", "')}".`,
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
