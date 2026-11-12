import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { startScheduler } from "../src/scheduler.js";

afterEach(() => vi.useRealTimers());

function schedulerDb(claims: (string | null)[]) {
  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    if (name === "claim_scheduled_task")
      return { data: claims.shift() ?? null, error: null };
    return { data: null, error: null };
  });
  const schema = vi.fn(() => ({ rpc }));
  return { db: { schema } as unknown as SupabaseClient, rpc, schema };
}

it("runs the claimed task's SQL body and finishes ok", async () => {
  vi.useFakeTimers();
  const { db, rpc, schema } = schedulerDb(["expire_reservations"]);
  const stop = startScheduler(db, "worker-1", { intervalMs: 100 });
  await vi.advanceTimersByTimeAsync(0);
  expect(schema).toHaveBeenCalledWith("ops");
  expect(rpc.mock.calls).toEqual([
    ["claim_scheduled_task", { p_worker: "worker-1" }],
    ["expire_reservations"],
    [
      "finish_scheduled_task",
      {
        p_name: "expire_reservations",
        p_worker: "worker-1",
        p_ok: true,
        p_error: null,
      },
    ],
  ]);
  stop();
});

it("records the error and keeps running when a body throws", async () => {
  vi.useFakeTimers();
  const remaining = ["purge_oauth", "purge_audit"];
  const { db, rpc } = schedulerDb([]);
  rpc.mockImplementation(async (name: string) => {
    if (name === "claim_scheduled_task")
      return { data: remaining.shift() ?? null, error: null };
    if (name === "purge_oauth") throw new Error("body failed");
    return { data: null, error: null };
  });
  const stop = startScheduler(db, "worker-1", { intervalMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  expect(rpc).toHaveBeenCalledWith("finish_scheduled_task", {
    p_name: "purge_oauth",
    p_worker: "worker-1",
    p_ok: false,
    p_error: "body failed",
  });
  expect(rpc).toHaveBeenCalledWith("finish_scheduled_task", {
    p_name: "purge_audit",
    p_worker: "worker-1",
    p_ok: true,
    p_error: null,
  });
  stop();
});

it("the stop function stops the timer", async () => {
  vi.useFakeTimers();
  const { db, rpc } = schedulerDb([null]);
  const stop = startScheduler(db, "worker-1", { intervalMs: 100 });
  await vi.advanceTimersByTimeAsync(0);
  stop();
  await vi.advanceTimersByTimeAsync(300);
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("reports the failed RPC and safe code without exposing its message, then retries", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const { db, rpc } = schedulerDb(["expire_reservations"]);
  rpc.mockRejectedValueOnce(
    Object.assign(new Error("password=private-value"), { code: "PGRST301" }),
  );
  const stop = startScheduler(db, "worker-1", { intervalMs: 100 });
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(log).toHaveBeenCalledWith(
      "Scheduler claim_scheduled_task RPC failed (PGRST301)",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-value");
    expect(rpc).toHaveBeenCalledWith("expire_reservations");
  } finally {
    stop();
    log.mockRestore();
  }
});
