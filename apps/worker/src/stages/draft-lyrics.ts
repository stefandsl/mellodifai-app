import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LyricPackSchema, validateLyricPack } from "@mellodifai/shared";
import { optionalText } from "../legacy-import.js";
import type { StageHandler } from "../loop.js";
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
  "Write a new VBP lyric pack for the topic below and reply with one JSON object with exactly these keys:",
  '"title": string, at most 100 characters (reference file title.txt).',
  '"lyrics": string, the full lyrics with [Section] tag lines, exactly 80 sung lines in the same section structure as the reference (reference file lyrics.txt).',
  '"style": string, the music style prompt, at most 1000 characters (reference file style.txt).',
  '"exclude": string, comma-separated styles to avoid (reference file exclude.txt).',
  '"l10n": object with the same keys as the reference storyboard-l10n.json, values written in the requested language.',
  "No other keys, no Markdown, no commentary. Never use the em dash character (U+2014).",
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
) {
  return {
    title: draft.title,
    lyrics: draft.lyrics,
    style: draft.style,
    exclude: draft.exclude ?? "",
    l10n: draft.l10n ?? {},
    settings: {
      model: "V6",
      vocalGender: vocalGender === "m" ? "m" : "f",
      styleWeight: 0.7,
      weirdness: 0.35,
      duration: 310,
    },
    displayMap,
  };
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

export const draftLyrics: StageHandler = async (context) => {
  const cap = Number(context.secrets.values.LYRICS_DAILY_CAP ?? "50");
  const stateFile =
    context.secrets.values.LYRICS_STATE_FILE ??
    "E:\\mellodifai\\state\\lyrics.json";
  const {
    mkdir,
    readFile: stateRead,
    writeFile,
  } = await import("node:fs/promises");
  const today = new Date().toISOString().slice(0, 10);
  let state: { day?: string; count?: number } = {};
  try {
    state = JSON.parse(await stateRead(stateFile, "utf8")) as typeof state;
  } catch {}
  const count = state.day === today ? (state.count ?? 0) : 0;
  if (count >= cap) throw new Error("daily lyrics cap reached");
  const template = await draftReference(context.version.lang);
  const displayMap = await referenceDisplayMap(context.version.lang);
  let correction = "";
  for (let call = 0; call < 3; call += 1) {
    if (count + call >= cap) throw new Error("daily lyrics cap reached");
    // Reserve before making the request, including requests that fail in transit.
    await mkdir(join(stateFile, ".."), { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({ day: today, count: count + call + 1 }),
    );
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${context.secrets.values.OPENROUTER_API_KEY ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model:
            context.secrets.values.LYRICS_MODEL ??
            "anthropic/claude-sonnet-5.5",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: DRAFT_INSTRUCTIONS,
            },
            {
              role: "user",
              content: `Language: ${context.version.lang}\nTopic: ${context.project.topic}\nBrief: ${context.project.brief ?? ""}\nStyle: ${context.project.style ?? ""}\nMood: ${context.project.mood ?? ""}\nVocal gender: ${context.project.vocal_gender ?? "f"}\nReference:\n${template}\n${correction}`,
            },
          ],
        }),
        signal: context.signal,
      },
    );
    if (!response.ok)
      throw new Error(`OpenRouter request failed: ${response.status}`);
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = buildPack(
      parseReply(body.choices?.[0]?.message?.content ?? ""),
      context.project.vocal_gender,
      displayMap,
    );
    const parsed = LyricPackSchema.safeParse(raw);
    const validation = validateLyricPack(
      parsed.success ? parsed.data : raw,
      "vbp",
    );
    if (parsed.success && validation.ok)
      return {
        versionStatus: "lyrics_review",
        patch: { lyric_pack: parsed.data },
      };
    correction = `Correct these validation errors and return JSON only: ${(validation.ok ? [] : validation.errors).join("; ")}`;
  }
  throw new Error(
    `lyric pack validation failed after 3 attempts: ${correction}`,
  );
};
