import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type TakeScores,
  TakeScoresSchema,
  type TimedWord,
  timingFromWords,
} from "@mellodifai/shared";
import type { Take } from "../db.js";
import type { StageContext } from "../loop.js";
import { ENGINE_ROOT, language } from "./utils.js";

// score_takes.py rows use snake_case; the take number is in the file name ("take-2.mp3").
function scoresByTake(report: unknown): Map<number, TakeScores> {
  const found = new Map<number, TakeScores>();
  const rows = (report as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return found;
  for (const row of rows as Record<string, unknown>[]) {
    const number = /^take-(\d+)\.mp3$/u.exec(String(row?.take))?.[1];
    const parsed = TakeScoresSchema.safeParse({
      fidelity: row.fidelity,
      duration: row.duration,
      endDropDb: row.end_drop_db,
      weakSections: row.weak_sections,
      truncated: row.truncated,
    });
    if (number && parsed.success) found.set(Number(number), parsed.data);
  }
  return found;
}

// The words score_takes.py heard in each take (take-N.words.json) laid over the song's lyrics:
// the times "Riscrivi una parte" lights lines with until the timing stage measures the take.
export async function storeHeardTiming(
  context: StageContext,
  takes: Take[],
): Promise<void> {
  const lyrics = (context.version.lyric_pack as { lyrics?: unknown } | null)
    ?.lyrics;
  if (typeof lyrics !== "string" || !lyrics.trim()) return;
  for (const take of takes) {
    try {
      const heard = JSON.parse(
        await readFile(
          join(context.ws.outDir, `take-${take.take_number}.words.json`),
          "utf8",
        ),
      ) as TimedWord[];
      const timing = Array.isArray(heard)
        ? timingFromWords(lyrics, heard, "whisper")
        : null;
      if (timing) await context.db.patchTake(take.id, { lyric_timing: timing });
    } catch {
      /* No words for this take: the owner marks the lines himself. */
    }
  }
}

// Hears each take with Groq Whisper and stores takes.scores, so the studio can suggest one.
// Scores are a nicety: any failure is logged and the takes keep no scores, never failing the song.
// ceiling: an engine length limit (YuE2 max_duration); a take ending within 5 s of it, or one
// listed in truncated (its log reported the token budget), was cut by the engine.
export async function scoreTakes(
  context: StageContext,
  takes: Take[],
  options: { ceiling?: number; truncated?: ReadonlySet<number> } = {},
): Promise<void> {
  try {
    if (!context.secrets.values.GROQ_API_KEY) {
      await context.log("Takes not scored: GROQ_API_KEY is not set");
      return;
    }
    const lang = language(context);
    const reportFile = join(context.ws.outDir, "takes-score.json");
    await context.engine.run(
      "python",
      [
        "-I",
        "tools/score_takes.py",
        lang,
        "--workspace",
        context.ws.root,
        // Local engines make short songs too; do not rank by length.
        "--min-duration",
        "0",
      ],
      {
        cwd: ENGINE_ROOT,
        secretEnv: ["GROQ_API_KEY"],
        // A report left by an earlier generation must never be read as this one's.
        clearOutputs: [reportFile],
      },
    );
    const report: unknown = JSON.parse(await readFile(reportFile, "utf8"));
    const scores = scoresByTake(report);
    for (const take of takes) {
      const number = take.take_number;
      const own = number && scores.get(number);
      if (!own) continue;
      const cut =
        options.truncated?.has(number) ||
        (options.ceiling !== undefined && own.duration >= options.ceiling - 5);
      await context.db.patchTake(take.id, {
        scores: cut ? { ...own, truncated: true } : own,
      });
    }
    await storeHeardTiming(context, takes);
  } catch (error) {
    try {
      await context.log(
        context.secrets.redact(`Take scoring failed: ${String(error)}`),
      );
    } catch {
      /* Scoring telemetry must never fail the generation. */
    }
  }
}
