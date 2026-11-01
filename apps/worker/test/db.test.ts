import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const eq = vi.fn();
  const query = Object.assign(Promise.resolve({ error: null }), { eq });
  eq.mockReturnValue(query);
  const update = vi.fn((_values: Record<string, unknown>) => query);
  const insert = vi.fn(async (_values: Record<string, unknown>) => ({
    error: null,
  }));
  return {
    eq,
    update,
    insert,
    from: vi.fn((_table: string) => ({ update, insert })),
  };
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mocks.from }),
}));

import { SupabaseDb } from "../src/db.js";

it("filters every terminal/requeue write by job id, owning worker, and running status", async () => {
  const db = new SupabaseDb("http://localhost", "test-key");
  for (const operation of [
    () => db.finishJob("job", {}, "worker"),
    () => db.failJob("job", "error", "worker"),
    () => db.requeue("job", "worker"),
    () => db.patchJobPayload("job", "worker", { seeds: { "1": 5 } }),
  ]) {
    mocks.eq.mockClear();
    await operation();
    expect(mocks.eq.mock.calls).toEqual([
      ["id", "job"],
      ["worker_id", "worker"],
      ["status", "running"],
    ]);
  }
  expect(mocks.update.mock.calls.at(-1)?.[0]).not.toHaveProperty("attempts");
});

it("patches one take by id", async () => {
  const db = new SupabaseDb("http://localhost", "test-key");
  mocks.eq.mockClear();
  await db.patchTake("take", { scores: { fidelity: 0.9 } });
  expect(mocks.from).toHaveBeenLastCalledWith("takes");
  expect(mocks.update).toHaveBeenLastCalledWith({ scores: { fidelity: 0.9 } });
  expect(mocks.eq.mock.calls).toEqual([["id", "take"]]);
});

it("writes a job's events under the job's owner, not the worker's", async () => {
  // A song of another user (the e2e admin, a customer): job_events (job_id, owner_id) must
  // match the job, or the foreign key refuses every log line and progress value.
  const db = new SupabaseDb("http://localhost", "test-key", "worker-owner");
  await db.appendEvent({ id: "job", owner_id: "song-owner" }, "Stems: 40%", 40);
  expect(mocks.from).toHaveBeenLastCalledWith("job_events");
  expect(mocks.insert).toHaveBeenLastCalledWith({
    owner_id: "song-owner",
    job_id: "job",
    message: "Stems: 40%",
    progress: 40,
  });
});
