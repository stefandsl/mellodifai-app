import type { StageContext } from "../loop.js";

export const KIE_TEST_TEXT =
  "Canzone di prova: kie non viene chiamato per un account di test (nessun credito usato). Per una prova voluta imposta ALLOW_TEST_KIE=1 sul worker.";

// kie charges real credits. A song of a test account (an e-mail ending in ".test", like
// e2e-admin@mellodifai.test) or a project marked as a test (song_settings.test) never reaches it,
// unless the worker runs with ALLOW_TEST_KIE=1. A full-flow test on the live stack spent 12
// credits on 2026-11-01 before this guard.
export async function kieAllowed(context: StageContext): Promise<boolean> {
  const flag =
    context.secrets.values.ALLOW_TEST_KIE ?? process.env.ALLOW_TEST_KIE;
  if (flag === "1") return true;
  const settings = context.project.song_settings as { test?: unknown } | null;
  if (settings && typeof settings === "object" && settings.test === true)
    return false;
  const owner = context.version.owner_id ?? context.project.owner_id;
  const email = owner ? await context.db.getOwnerEmail(owner) : null;
  // An owner the worker cannot read is not trusted with paid calls either.
  if (!email) return false;
  return !email.trim().toLowerCase().endsWith(".test");
}

// Called before every paid kie call: fails the job with a clear sentence, never retried.
export async function assertKieAllowed(context: StageContext): Promise<void> {
  if (await kieAllowed(context)) return;
  await context.log("kie refused: test account or test song");
  throw new Error(KIE_TEST_TEXT);
}
