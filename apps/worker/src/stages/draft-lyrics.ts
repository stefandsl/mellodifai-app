import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type LyricPack,
  LyricPackSchema,
  SongSettingsSchema,
  validateLyricPack,
} from "@mellodifai/shared";
import { optionalText } from "../legacy-import.js";
import type { StageHandler } from "../loop.js";
import { isCapRefusal } from "../providers/ledger.js";
import { openRouterCall, openRouterRequest } from "../providers/openrouter.js";
import {
  combine,
  DEFAULT_JUDGES,
  DEFAULT_WRITERS,
  type JuryReport,
  judge,
  looksRedacted,
  lyricsBudget,
  PASS_SCORE,
  REDACTION_NOTE,
  type Route,
  revisionBrief,
  route,
  toneLine,
  type Writer,
} from "./lyric-jury.js";
import { ENGINE_ROOT } from "./utils.js";

const reference = async (lang: string) =>
  Promise.all(
    [
      "lyrics.txt",
      "title.txt",
      "style.txt",
      "settings.json",
      "exclude.txt",
      "display-map.json",
      "storyboard-l10n.json",
    ].map(
      async (name) =>
        `${name}:\n${await (["lyrics.txt", "title.txt", "style.txt"].includes(name) ? readFile(join(ENGINE_ROOT, "versions", lang, name), "utf8") : optionalText(join(ENGINE_ROOT, "versions", lang, name), name.endsWith(".json") ? "{}" : ""))}`,
    ),
  ).then((files) => files.join("\n\n"));

function sungLines(lyrics: string) {
  return lyrics
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trim().startsWith("[")).length;
}

export async function draftReference(lang: string) {
  const target = await reference(lang);
  const lyrics = await readFile(
    join(ENGINE_ROOT, "versions", lang, "lyrics.txt"),
    "utf8",
  );
  if (sungLines(lyrics) === 80) return target;
  const italianLyrics = await readFile(
    join(ENGINE_ROOT, "versions", "it", "lyrics.txt"),
    "utf8",
  );
  if (sungLines(italianLyrics) !== 80)
    throw new Error("Italian VBP template must contain 80 sung lines");
  return `80-line structural template (Italian; translate into the requested language):\n${await reference("it")}\n\nStyle/vocabulary only (ignore this reference's line count and structure):\n${target}`;
}

// The model writes only the creative fields; the worker owns everything else.
const DRAFT_INSTRUCTIONS = [
  "Write an original song about the topic below. The reference song is a format only: copy its section structure, its 80 sung lines and its chant pattern, but the subject, story, title, hook and every lyric line must come from the topic.",
  "Never reuse the reference's topic, title, characters or phrases. When a style is given, build the style prompt from it.",
  "Reply with one JSON object with exactly these keys:",
  '"title": string, at most 100 characters (reference file title.txt).',
  '"lyrics": string, the full lyrics with [Section] tag lines, exactly 80 sung lines in the same section structure as the reference (reference file lyrics.txt).',
  '"style": string, the music style prompt, at most 1000 characters (reference file style.txt).',
  '"exclude": string, comma-separated styles to avoid (reference file exclude.txt).',
  '"l10n": object with the same keys as the reference storyboard-l10n.json, values written in the requested language.',
  "No other keys, no Markdown, no commentary. Never use the em dash character (U+2014).",
  REDACTION_NOTE,
].join("\n");

function parseReply(content: string): Record<string, unknown> {
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "");
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function buildPack(
  draft: Record<string, unknown>,
  vocalGender: string | null | undefined,
  displayMap: Record<string, string>,
  songSettings: unknown,
) {
  // Studio projects carry the form settings; projects created before the studio have none.
  const parsed = SongSettingsSchema.safeParse(songSettings ?? {});
  const form = parsed.success ? parsed.data : SongSettingsSchema.parse({});
  const studio = parsed.success && Object.keys(songSettings ?? {}).length > 0;
  return {
    title: form.title || draft.title,
    lyrics: draft.lyrics,
    style: draft.style,
    exclude: form.exclude || (draft.exclude ?? ""),
    l10n: draft.l10n ?? {},
    settings: {
      model: form.model,
      ...(vocalGender === "m" || vocalGender === "f"
        ? { vocalGender }
        : studio
          ? {}
          : { vocalGender: "f" }),
      styleWeight: form.styleWeight ?? 0.7,
      weirdness: form.weirdness ?? 0.35,
      variety: form.variety ?? 1,
      duration: studio ? (form.duration ?? null) : 310,
    },
    displayMap,
  };
}

// Studio projects store lyrics the user wrote as the brief; the draft keeps their words.
function briefLine(project: {
  brief?: string | null;
  song_settings?: unknown;
}): string {
  const studio = Object.keys(project.song_settings ?? {}).length > 0;
  return studio && project.brief
    ? `Lyrics written by the user (keep their words, arrange them into the reference format):
${project.brief}`
    : `Brief: ${project.brief ?? ""}`;
}

async function referenceDisplayMap(
  lang: string,
): Promise<Record<string, string>> {
  try {
    const value: unknown = JSON.parse(
      await optionalText(
        join(ENGINE_ROOT, "versions", lang, "display-map.json"),
        "{}",
      ),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  } catch {
    return {};
  }
}

// Writer calls per draft: at most MAX_FORMAT_ATTEMPTS drafts that break the format, plus
// the jury's revision rounds. Each call counts against the daily cap.
const MAX_WRITER_CALLS = 5;
const MAX_FORMAT_ATTEMPTS = 3;
const MAX_REVISIONS = 2;

type Candidate = { pack: LyricPack; jury: JuryReport };

// The lowest criterion decides which rejected draft is the least bad.
function worst(jury: JuryReport): number {
  const values = Object.values(jury.scores);
  return values.length ? Math.min(...values) : 0;
}

export const draftLyrics: StageHandler = async (context) => {
  const secrets = context.secrets.values;
  const budget = await lyricsBudget(secrets);
  const template = await draftReference(context.version.lang);
  const displayMap = await referenceDisplayMap(context.version.lang);
  const referenceTitle = (
    await optionalText(
      join(ENGINE_ROOT, "versions", context.version.lang, "title.txt"),
      "",
    )
  ).trim();
  const call = openRouterCall(context);
  const writers = {
    strong: secrets.LYRICS_MODEL_STRONG ?? DEFAULT_WRITERS.strong,
    fast: secrets.LYRICS_MODEL_FAST ?? DEFAULT_WRITERS.fast,
  };
  const judges = secrets.LYRICS_JUDGES
    ? secrets.LYRICS_JUDGES.split(",").map((model) => model.trim())
    : DEFAULT_JUDGES;
  const passScore = Number(secrets.LYRICS_JURY_PASS ?? PASS_SCORE);
  // LYRICS_JURY=off skips the router and the jury: one strong writer, format checks only.
  const juryOn = secrets.LYRICS_JURY !== "off";
  const started = performance.now();

  const plan: Route = juryOn
    ? await route(
        {
          topic: context.project.topic,
          brief: context.project.brief ?? "",
          style: context.project.style ?? "",
          lang: context.version.lang,
        },
        call,
      )
    : { tone: null, writer: "strong", confidence: 0, ms: 0 };
  let writer: Writer = plan.writer;
  let correction = "";
  let revisions = 0;
  let formatFailures = 0;
  let best: Candidate | undefined;
  let incomplete = false;
  const rounds: {
    writer: string;
    passed: boolean;
    scores: JuryReport["scores"];
  }[] = [];

  for (let calls = 0; calls < MAX_WRITER_CALLS; calls += 1) {
    // Reserve before making the request, including requests that fail in transit.
    await budget.reserve();
    const response = await openRouterRequest(
      "chat",
      {
        model: writers[writer],
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: DRAFT_INSTRUCTIONS,
          },
          {
            role: "user",
            content: `Language: ${context.version.lang}\nTopic: ${context.project.topic}\n${briefLine(context.project)}\nStyle: ${context.project.style ?? ""}\nMood: ${context.project.mood ?? ""}\n${toneLine(plan.tone)}\nVocal gender: ${context.project.vocal_gender ?? "f"}\nReference (format only):\n${template}\n${correction}`,
          },
        ],
      },
      call,
    ).catch((error: unknown) => {
      if (best && isCapRefusal(error)) {
        incomplete = true;
        return null;
      }
      throw error;
    });
    if (!response) break;
    if (!response.ok)
      throw new Error(`OpenRouter request failed: ${response.status}`);
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = buildPack(
      parseReply(body.choices?.[0]?.message?.content ?? ""),
      context.project.vocal_gender,
      displayMap,
      context.project.song_settings,
    );
    const parsed = LyricPackSchema.safeParse(raw);
    const validation = validateLyricPack(
      parsed.success ? parsed.data : raw,
      "vbp",
    );
    if (!parsed.success || !validation.ok) {
      correction = `Correct these validation errors and return JSON only: ${(validation.ok ? [] : validation.errors).join("; ")}`;
      formatFailures += 1;
      // A revision that breaks the format keeps the best earlier draft instead.
      if (formatFailures >= MAX_FORMAT_ATTEMPTS || best) break;
      continue;
    }
    const jury = juryOn
      ? await judge(
          parsed.data,
          {
            topic: context.project.topic,
            lang: context.version.lang,
            referenceTitle,
          },
          judges,
          call,
          passScore,
        ).catch((error: unknown) => {
          if (!isCapRefusal(error)) throw error;
          incomplete = true;
          return { ...combine([], 0, passScore), passed: false };
        })
      : combine([], 0, passScore);
    rounds.push({
      writer: writers[writer],
      passed: jury.passed,
      scores: jury.scores,
    });
    if (!best || jury.passed || worst(jury) > worst(best.jury))
      best = { pack: parsed.data, jury };
    if (incomplete || jury.passed || revisions >= MAX_REVISIONS) break;
    revisions += 1;
    writer = jury.improver;
    correction = `${revisionBrief(jury)}\nPrevious draft:\n${JSON.stringify({ title: parsed.data.title, lyrics: parsed.data.lyrics, style: parsed.data.style })}`;
  }
  if (!best)
    throw new Error(
      `lyric pack validation failed after ${formatFailures} attempts: ${correction}`,
    );
  return {
    versionStatus: "lyrics_review",
    patch: {
      lyric_pack: best.pack,
      lyric_jury: {
        route: plan,
        writers,
        passed: best.jury.passed,
        available: best.jury.available,
        scores: best.jury.scores,
        failing: best.jury.failing,
        issues: best.jury.issues,
        verdicts: best.jury.verdicts,
        rounds,
        threshold: passScore,
        redacted:
          best.jury.redacted ||
          looksRedacted(context.project.topic, best.pack.lyrics),
        ms: Math.round(performance.now() - started),
        incomplete,
      },
    },
  };
};
