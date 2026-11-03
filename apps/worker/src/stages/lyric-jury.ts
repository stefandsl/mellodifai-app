// Lyric pipeline helpers: a fast router picks the tone and the writer, and a jury of
// models scores each draft. Every call is best effort: a router or judge that fails is
// left out, so a provider outage slows nothing down and never blocks a song.

import {
  OPENROUTER_CHAT_URL as CHAT_URL,
  OPENROUTER_DECISIONS_URL as DECISIONS_URL,
} from "../providers/paid.js";
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
    secrets.LYRICS_STATE_FILE ?? "E:\\mellodifai\\state\\lyrics.json";
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

type Fetch = typeof globalThis.fetch;
type Call = { key: string; signal?: AbortSignal; fetchFn?: Fetch };

async function post(
  url: string,
  body: unknown,
  { key, signal, fetchFn = globalThis.fetch }: Call,
  timeoutMs: number,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  return response.json();
}

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
        DECISIONS_URL,
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
type Context = { topic: string; lang: string; referenceTitle: string };

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
      DECISIONS_URL,
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
  "You are a strict judge of song lyrics. Score the draft on each criterion from 0 to 1:",
  ...CRITERION_KEYS.map((key) => `"${key}": ${CRITERIA[key]}`),
  'Reply with one JSON object: {"scores": {criterion: number}, "issues": [short concrete problems, quoting the line], "improver": "strong" or "fast"}.',
  'Use "strong" when the draft needs deep rewriting, "fast" when small fixes are enough.',
].join("\n");

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

async function chatVerdict(
  model: string,
  draft: Draft,
  context: Context,
  call: Call,
): Promise<Omit<Verdict, "model" | "ms">> {
  const json = (await post(
    CHAT_URL,
    {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_INSTRUCTIONS },
        {
          role: "user",
          content: `Requested topic: ${context.topic}\nLanguage: ${context.lang}\nReference song title (must not be reused): ${context.referenceTitle}\nTitle: ${draft.title}\nStyle: ${draft.style}\nLyrics:\n${draft.lyrics}`,
        },
      ],
    },
    call,
    25_000,
  )) as { choices?: { message?: { content?: string } }[] };
  const reply = parseJson(json.choices?.[0]?.message?.content ?? "");
  const scores = complete(
    (reply.scores && typeof reply.scores === "object"
      ? reply.scores
      : {}) as Record<string, unknown>,
  );
  if (!scores) throw new Error("incomplete verdict");
  return {
    scores,
    issues: Array.isArray(reply.issues)
      ? reply.issues.filter((i): i is string => typeof i === "string")
      : [],
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
