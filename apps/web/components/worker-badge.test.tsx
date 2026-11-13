import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeDb } from "@/test/fake-supabase";

const db = fakeDb();
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => db.client }));

import { LocaleProvider } from "./locale-provider";
import { WorkerBadge } from "./worker-badge";

beforeEach(() => {
  db.tables = { workers: [] };
  db.reads.length = 0;
});
afterEach(() => vi.useRealTimers());

it("renders offline when the worker heartbeat is older than 45 seconds", () => {
  render(
    <WorkerBadge
      lastSeen="2026-10-31T10:00:00.000Z"
      now={new Date("2026-10-31T10:00:46.000Z").getTime()}
    />,
  );
  expect(screen.getByText(/offline/i)).toBeInTheDocument();
});

it("worker heartbeat expires on the 15 second clock, reading only its own worker row", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
  render(
    <LocaleProvider value="en">
      <WorkerBadge
        workerId="pc"
        lastSeen={new Date().toISOString()}
        balance={12}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("Online")).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(screen.getByText(/Offline since/)).toBeInTheDocument();
  expect(db.reads.length).toBeGreaterThan(0);
  expect(db.reads.map((read) => [read.table, ...read.filters])).toEqual(
    db.reads.map(() => ["workers", "id=eq.pc"]),
  );
});
