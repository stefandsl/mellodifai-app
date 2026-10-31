import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const eq = vi.fn();
  const query = Object.assign(Promise.resolve({ error: null }), { eq });
  eq.mockReturnValue(query);
  return { eq, update: vi.fn((_values: Record<string, unknown>) => query) };
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => ({ update: mocks.update }) }),
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
