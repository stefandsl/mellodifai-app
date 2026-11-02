// Fake "Scrivi con AI", "Rigenera" and "Migliora" for the e2e stack (WORKER_FAKE=1): canned
// lyrics after a short pause, a passing jury, no OpenRouter call.
import { setTimeout } from "node:timers/promises";
import {
  LyricsAssistInputSchema,
  LyricsAssistResultSchema,
  spliceSection,
} from "@mellodifai/shared";
import type { SonglessHandler, SonglessRegistry } from "../loop.js";

const WRITTEN = [
  "[Verse 1]",
  "Apro la finestra sul mattino",
  "il caffè che sale piano piano",
  "",
  "[Chorus]",
  "Oggi è un giorno nuovo",
  "e lo canto a voce piena",
  "",
  "[Verse 2]",
  "Scendo in strada senza fretta",
  "il quartiere mi saluta",
].join("\n");

export const fakeLyricsAssist: SonglessHandler = async (context) => {
  const request = await context.db.getLyricRequest(
    String(context.job.payload?.request_id ?? ""),
  );
  if (!request) throw new Error("lyrics request not found");
  const input = LyricsAssistInputSchema.parse({
    ...(request.input as Record<string, unknown>),
    mode: request.mode,
    lang: request.lang,
  });
  for (const [pct, step] of [
    [20, "assist.write"],
    [60, "assist.jury"],
  ] as const) {
    await setTimeout(500, undefined, { signal: context.signal });
    await context.progress(pct, step);
  }
  const lyrics =
    input.mode === "write"
      ? WRITTEN
      : input.mode === "improve"
        ? input.lyrics
            .split("\n")
            .map((line) =>
              line.trim() && !line.trim().startsWith("[")
                ? `${line.trim()}, sì`
                : line,
            )
            .join("\n")
        : input.section
          ? spliceSection(
              input.lyrics,
              input.section,
              `${input.lyrics.slice(input.section.start, input.section.end).split("\n")[0]}\nUna strofa scritta di nuovo\ncon parole tutte nuove`,
            )
          : WRITTEN.replace("mattino", "tramonto");
  await context.db.patchLyricRequest(request.id, {
    result: LyricsAssistResultSchema.parse({
      lyrics,
      title: input.mode === "write" ? "Giorno nuovo" : null,
      jury: {
        available: true,
        passed: true,
        scores: {
          topic: 0.9,
          language: 0.88,
          singable: 0.84,
          chorus: 0.82,
          original: 0.95,
        },
        issues: [],
        redacted: false,
      },
      writer: "fake",
      ms: 1000,
    }),
  });
  await context.progress(100, "assist.done");
  return {};
};

export const fakeSongless: SonglessRegistry = {
  lyrics_assist: fakeLyricsAssist,
};
