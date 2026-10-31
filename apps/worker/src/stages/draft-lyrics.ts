import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LyricPackSchema, validateLyricPack } from "@mellodifai/shared";
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
        `${name}:\n${await readFile(join(ENGINE_ROOT, "versions", lang, name), "utf8")}`,
    ),
  ).then((files) => files.join("\n\n"));

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
  const template = await reference(context.version.lang);
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
              content:
                "Return only a new VBP lyric pack JSON. Preserve the exact 80 sung-line section structure and storyboard-l10n keys of this reference. Do not use the prohibited punctuation character.",
            },
            {
              role: "user",
              content: `Language: ${context.version.lang}\nTopic: ${context.project.topic}\nBrief: ${context.project.brief ?? ""}\nStyle: ${context.project.style ?? ""}\nReference:\n${template}\n${correction}`,
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
    let raw: unknown;
    try {
      raw = JSON.parse(body.choices?.[0]?.message?.content ?? "");
    } catch {
      raw = {};
    }
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
