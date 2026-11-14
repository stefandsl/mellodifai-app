import type { TsvCapLedger } from "./cap-ledger.js";
import { type KieClient, KieFailed, KieRefused } from "./kie-client.js";
import { type MediaTask, runMediaTask } from "./kie-media.js";
import { openPaidEntry } from "./paid.js";

// A paid kie call whose outcome is unknown (the submission or the task may have been charged):
// its reservation stays held at the estimate, marked ambiguous, and the run must stop.
export class RunStopped extends Error {}

function failedOnKie(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause)
    if (e instanceof KieFailed) return true;
  return false;
}

export type PaidJob = {
  label: string;
  model: string;
  units: string;
  estimate: number;
  body: { model: string; input: Record<string, unknown> };
  file: string;
};

// One paid generation of a run outside the job database: reservation, balance check, submit, wait,
// download, settlement. A second attempt is made only when kie refused the submission (nothing
// charged) or the task failed on kie's side (kie charges nothing for a failed task). Any other
// failure after the request left (a submission with no answer, a task still pending, an unreadable
// result) keeps the reservation open at its estimate, marks it ambiguous and throws RunStopped.
export async function generatePaid(
  ledger: TsvCapLedger,
  kie: KieClient,
  job: PaidJob,
  taskOptions: { timeoutMs?: number; pollMs?: number } = {},
): Promise<MediaTask> {
  const { label, model, units, estimate, body, file } = job;
  for (let attempt = 1; ; attempt++) {
    // Throws a cap refusal (nothing reserved, nothing spent) when the cap cannot hold it.
    const entry = await openPaidEntry(ledger, `${model}|${units}`, {
      credits: estimate,
    });
    let before: number;
    try {
      before = await kie.credits();
    } catch (error) {
      await ledger.settle(entry, { credits: 0 });
      throw error;
    }
    if (before < estimate) {
      await ledger.settle(entry, { credits: 0 });
      throw new Error(
        `${label}: balance ${before} below the ${estimate} credits it needs (short by ${Math.round((estimate - before) * 100) / 100})`,
      );
    }
    let submitted = false;
    let task: MediaTask;
    try {
      task = await runMediaTask(kie, body, {
        ...taskOptions,
        onSubmitted: async (id) => {
          submitted = true;
          await ledger.note(
            `${label}: submitted task ${id} (attempt ${attempt})`,
          );
        },
      });
    } catch (error) {
      const message = (error as Error).message;
      const retryable = submitted
        ? failedOnKie(error)
        : error instanceof KieRefused;
      if (!retryable) {
        await ledger.markAmbiguous(entry);
        await ledger.note(
          `${label}: attempt ${attempt} outcome unknown, ${entry} held at ${estimate} credits until checked on the kie dashboard: ${message}`,
        );
        throw new RunStopped(
          `${label}: outcome unknown (${message}); ${entry} stays held at ${estimate} credits, run stopped`,
          { cause: error },
        );
      }
      await ledger.settle(entry, { credits: 0 });
      await ledger.note(`${label}: attempt ${attempt} failed: ${message}`);
      if (attempt >= 2) throw error;
      continue;
    }
    const after = await kie.credits().catch(() => before - estimate);
    await ledger.settle(entry, {
      credits: task.credits ?? Math.max(0, before - after),
    });
    try {
      await kie.download(task.urls[0] as string, file);
    } catch (error) {
      await ledger.note(
        `${label}: task ${task.taskId} paid but its download failed: ${(error as Error).message}`,
      );
      throw error;
    }
    return task;
  }
}
