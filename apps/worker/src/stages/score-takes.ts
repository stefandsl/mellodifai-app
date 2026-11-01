import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type TakeScores, TakeScoresSchema } from "@mellodifai/shared";
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

// Hears each take with Groq Whisper and stores takes.scores, so the studio can suggest one.
// Scores are a nicety: any failure is logged and the takes keep no scores, never failing the song.
export async function scoreTakes(
  context: StageContext,
  takes: Take[],
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
      const own = take.take_number && scores.get(take.take_number);
      if (own) await context.db.patchTake(take.id, { scores: own });
    }
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
