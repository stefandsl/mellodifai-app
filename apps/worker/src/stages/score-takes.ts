import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type TakeScores,
  TakeScoresSchema,
  type TimedWord,
  timingFromWords,
} from "@mellodifai/shared";
import type { Take } from "../db.js";
import { EngineAuthorizationError } from "../engine.js";
import type { StageContext } from "../loop.js";
import type { Ledger } from "../providers/ledger.js";
import { callKey, groqAvailable } from "../providers/paid.js";
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
// Scorer failures are optional; ledger failures must fail the job.
// ceiling: an engine length limit (YuE2 max_duration); a take ending within 5 s of it, or one
// listed in truncated (its log reported the token budget), was cut by the engine.
export async function scoreTakes(
  context: StageContext,
  takes: Take[],
  options: { ceiling?: number; truncated?: ReadonlySet<number> } = {},
): Promise<void> {
  let ledgerOperation = false;
  try {
    if (!groqAvailable(context.secrets.values)) {
      await context.log("Takes not scored: GROQ_API_KEY is not set");
      return;
    }
    const lang = language(context);
    const reportFile = join(context.ws.outDir, "takes-score.json");
    const files = await readdir(context.ws.outDir);
    const takeByNumber = new Map(takes.map((take) => [take.take_number, take]));
    for (const file of files) {
      const number = /^take-(\d+)\.mp3$/u.exec(file)?.[1];
      if (number && !takeByNumber.has(Number(number)))
        throw new Error("Take scoring found an untracked take");
    }
    const uncached: Take[] = [];
    for (const take of takes) {
      if (!take.take_number) continue;
      try {
        await access(
          join(context.ws.outDir, `take-${take.take_number}.words.json`),
        );
      } catch {
        uncached.push(take);
      }
    }
    const entries: Array<{ take: Take; id: string }> = [];
    let ledger: Ledger | undefined;
    if (uncached.length) {
      ledgerOperation = true;
      if (!context.groqLedger) throw new Error("Groq ledger is not configured");
      ledger = context.groqLedger();
      if (!(await ledger.reservationFor(context.job.id)))
        throw new Error("cap_exceeded: Groq scoring has no reservation");
      if ((context.job.attempts ?? 1) > 1)
        await ledger.extendStage(context.job.id);
      for (const take of uncached) {
        const key = callKey("groq", {
          takeId: take.id,
          attempt: context.job.attempts ?? 1,
        });
        const estimate = { audio_hour: 0.1 };
        let id: string;
        try {
          id = await ledger.open(key, estimate);
        } catch (error) {
          if ((error as { code?: string } | null)?.code !== "MDF07")
            throw error;
          await ledger.extend(estimate);
          id = await ledger.open(key, estimate);
        }
        entries.push({ take, id });
      }
      ledgerOperation = false;
    }
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
        ...(entries.length
          ? {
              secretEnv: ["GROQ_API_KEY"],
              entryIds: entries.map(({ id }) => id),
            }
          : {}),
        // A report left by an earlier generation must never be read as this one's.
        clearOutputs: [reportFile],
      },
    );
    const report: unknown = JSON.parse(await readFile(reportFile, "utf8"));
    const scores = scoresByTake(report);
    const rows = (
      report as {
        rows?: Array<{ take?: string; provider_duration?: unknown }>;
      } | null
    )?.rows;
    ledgerOperation = true;
    for (const { take, id } of entries) {
      const row = Array.isArray(rows)
        ? rows.find((row) => row?.take === `take-${take.take_number}.mp3`)
        : undefined;
      const duration = row?.provider_duration;
      if (!ledger) throw new Error("Groq ledger is not configured");
      await ledger.settle(id, {
        audio_hour:
          typeof duration === "number" &&
          Number.isFinite(duration) &&
          duration >= 0
            ? duration / 3600
            : 0.1,
      });
    }
    ledgerOperation = false;
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
    if (ledgerOperation || error instanceof EngineAuthorizationError) {
      if (
        ["MDF02", "MDF06"].includes(
          (error as { code?: string } | null)?.code ?? "",
        )
      )
        throw new Error("cap_exceeded", { cause: error });
      throw error;
    }
    try {
      await context.log(
        context.secrets.redact(`Take scoring failed: ${String(error)}`),
      );
    } catch {
      /* Scoring telemetry must never fail the generation. */
    }
  }
}
