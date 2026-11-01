import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const eq = vi.fn();
  const query = Object.assign(Promise.resolve({ error: null }), { eq });
  eq.mockReturnValue(query);
  const update = vi.fn((_values: Record<string, unknown>) => query);
  return { eq, update, from: vi.fn((_table: string) => ({ update })) };
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
