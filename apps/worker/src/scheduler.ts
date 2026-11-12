import type { SupabaseClient } from "@supabase/supabase-js";

export function startScheduler(
  db: SupabaseClient,
  workerId: string,
  opts: { intervalMs?: number } = {},
): () => void {
  const ops = db.schema("ops");
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    let operation = "claim_scheduled_task";
    try {
      const claim = await ops.rpc("claim_scheduled_task", {
        p_worker: workerId,
      });
      if (claim.error) throw claim.error;
      const name = claim.data as string | null;
      if (!name) return;

      let bodyError: string | null = null;
      try {
        const body = await ops.rpc(name);
        if (body.error) throw body.error;
      } catch (error) {
        bodyError = error instanceof Error ? error.message : String(error);
      }
      operation = "finish_scheduled_task";
      const finish = await ops.rpc(operation, {
        p_name: name,
        p_worker: workerId,
        p_ok: bodyError === null,
        p_error: bodyError,
      });
      if (finish.error) throw finish.error;
    } catch (error) {
      // SQLSTATE/PostgREST codes diagnose failures without logging credential-bearing messages.
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      const detail = /^(?:[A-Z0-9]{5}|PGRST\d{3})$/u.test(code)
        ? ` (${code})`
        : "";
      console.error(`Scheduler ${operation} RPC failed${detail}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 30_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
