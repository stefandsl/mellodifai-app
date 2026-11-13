import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeDb } from "@/test/fake-supabase";

const db = fakeDb();
const mock = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => db.client }));

import { useLiveRefresh } from "./use-live-refresh";

const IDLE = 15_000;
const FAST = 2_000;
// Longer than the pause that gathers the tables of one tick into one refresh.
const SETTLE = 300;

const versions = () => db.tables.versions as Record<string, unknown>[];
const jobs = () => db.tables.jobs as Record<string, unknown>[];
const reads = (table: string) =>
  db.reads.filter((read) => read.table === table).length;
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  db.tables = {
    versions: [
      { id: "v1", updated_at: "2026-11-01T10:00:00Z" },
      { id: "v2", updated_at: "2026-11-01T11:00:00Z" },
    ],
    jobs: [
      {
        id: "j1",
        status: "done",
        started_at: "2026-11-01T10:00:00Z",
        finished_at: "2026-11-01T10:01:00Z",
        heartbeat_at: null,
        not_before: null,
      },
    ],
  };
  db.reads.length = 0;
  db.error = null;
});
afterEach(() => {
  cleanup();
  // An unmounted feed leaves no poll, no pending refresh and no hourly timer behind.
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it("does not refresh for the state the page was rendered with", async () => {
  renderHook(() => useLiveRefresh("data"));
  await advance(0);
  expect(reads("versions")).toBe(1);
  expect(reads("jobs")).toBe(2);
  await advance(IDLE * 4);
  expect(reads("versions")).toBe(5);
  expect(mock.refresh).not.toHaveBeenCalled();
});

it.each([
  [
    "a version is edited",
    () => {
      (versions()[0] as { updated_at: string }).updated_at =
        "2026-11-01T12:00:00Z";
    },
  ],
  [
    "a version is added",
    () => {
      versions().push({ id: "v3", updated_at: "2026-11-01T09:00:00Z" });
    },
  ],
  [
    "a version is deleted",
    () => {
      versions().splice(0, 1);
    },
  ],
  [
    "a job is queued",
    () => {
      jobs().push({
        id: "j2",
        status: "queued",
        started_at: null,
        finished_at: null,
        not_before: null,
      });
    },
  ],
  [
    "a job is deleted",
    () => {
      jobs().splice(0, 1);
    },
  ],
])("refreshes when %s", async (name, change) => {
  renderHook(() => useLiveRefresh("data"));
  await advance(0);
  change();
  await advance(IDLE - 1);
  expect(mock.refresh).not.toHaveBeenCalled();
  await advance(1 + SETTLE);
  expect(mock.refresh).toHaveBeenCalledOnce();
  await advance(IDLE * 3);
  expect(mock.refresh).toHaveBeenCalledTimes(
    name === "a job is queued" ? 4 : 1,
  );
});

it("follows a job through its life within two seconds, ignoring heartbeats", async () => {
  jobs().push({
    id: "j2",
    status: "queued",
    started_at: null,
    finished_at: null,
    heartbeat_at: null,
    not_before: null,
  });
  renderHook(() => useLiveRefresh("data"));
  await advance(0);
  const job = jobs()[1] as Record<string, unknown>;
  const steps: [Record<string, unknown>, number][] = [
    [{ status: "running", started_at: "2026-11-01T12:00:00Z" }, 1],
    [{ heartbeat_at: "2026-11-01T12:00:30Z" }, 1],
    [{ heartbeat_at: "2026-11-01T12:01:00Z" }, 1],
    [{ status: "done", finished_at: "2026-11-01T12:01:10Z" }, 2],
  ];
  for (const [patch, refreshes] of steps) {
    Object.assign(job, patch);
    await advance(FAST + SETTLE);
    expect(mock.refresh).toHaveBeenCalledTimes(refreshes);
  }
});

it("refreshes once for a change that shows in both tables", async () => {
  jobs().push({
    id: "j2",
    status: "running",
    started_at: "2026-11-01T12:00:00Z",
    finished_at: null,
    not_before: null,
  });
  renderHook(() => useLiveRefresh("data"));
  await advance(0);
  Object.assign(jobs()[1] as object, {
    status: "done",
    finished_at: "2026-11-01T12:01:00Z",
  });
  (versions()[0] as { updated_at: string }).updated_at = "2026-11-01T12:01:00Z";
  await advance(FAST + SETTLE);
  expect(mock.refresh).toHaveBeenCalledOnce();
});

it("polls every 2 seconds while the user has work in the queue, every 15 otherwise", async () => {
  jobs().push({
    id: "j2",
    status: "queued",
    started_at: null,
    finished_at: null,
    not_before: null,
  });
  renderHook(() => useLiveRefresh("data"));
  await advance(0);
  await advance(FAST * 3);
  expect(reads("versions")).toBe(4);
  Object.assign(jobs()[1] as object, {
    status: "cancelled",
    finished_at: "2026-11-01T12:00:00Z",
  });
  await advance(FAST);
  expect(reads("versions")).toBe(5);
  await advance(IDLE - 1);
  expect(reads("versions")).toBe(5);
  await advance(1);
  expect(reads("versions")).toBe(6);
});

it("watches only the tables it is given", async () => {
  renderHook(() => useLiveRefresh("data", ["jobs"]));
  await advance(0);
  (versions()[0] as { updated_at: string }).updated_at = "2026-11-01T12:00:00Z";
  await advance(IDLE + SETTLE);
  expect(db.reads.every((read) => read.table === "jobs")).toBe(true);
  expect(mock.refresh).not.toHaveBeenCalled();
  jobs().splice(0, 1);
  await advance(IDLE + SETTLE);
  expect(mock.refresh).toHaveBeenCalledOnce();
});

it("reads again at once when the page gets new server data", async () => {
  const rendered = ["a"];
  const view = renderHook(({ data }) => useLiveRefresh(data), {
    initialProps: { data: rendered },
  });
  await advance(0);
  expect(reads("versions")).toBe(1);
  view.rerender({ data: rendered });
  await advance(0);
  // The same data again is no reason to look.
  expect(reads("versions")).toBe(1);
  // The user queued a song: the action answered with new data, the worker has not claimed yet.
  jobs().push({
    id: "j2",
    status: "queued",
    started_at: null,
    finished_at: null,
    not_before: null,
  });
  view.rerender({ data: ["b"] });
  await advance(0);
  expect(reads("versions")).toBe(2);
  // The queued job is work in progress: the claim shows on the fast clock.
  Object.assign(jobs()[1] as object, {
    status: "running",
    started_at: "2026-11-01T12:00:00Z",
  });
  await advance(FAST + SETTLE);
  expect(reads("versions")).toBe(3);
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});

it("shares its reads between the feeds on the page", async () => {
  renderHook(() => useLiveRefresh("one"));
  renderHook(() => useLiveRefresh("two", ["jobs"]));
  await advance(0);
  await advance(IDLE);
  expect(reads("versions")).toBe(2);
  expect(reads("jobs")).toBe(4);
});

it("notices after an outage what changed during it", async () => {
  renderHook(() => useLiveRefresh("data"));
  await advance(0);
  db.error = "connection refused";
  versions().splice(0, 1);
  await advance(IDLE * 3);
  expect(mock.refresh).not.toHaveBeenCalled();
  db.error = null;
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(SETTLE);
  });
  expect(mock.refresh).toHaveBeenCalledOnce();
});

it("still refreshes before the signed media URLs expire", async () => {
  renderHook(() => useLiveRefresh("data"));
  await advance(50 * 60 * 1000 - 1);
  expect(mock.refresh).not.toHaveBeenCalled();
  await advance(1);
  expect(mock.refresh).toHaveBeenCalledOnce();
});

it("drops a refresh that is pending when the feed unmounts", async () => {
  const view = renderHook(() => useLiveRefresh("data"));
  await advance(0);
  versions().splice(0, 1);
  await advance(IDLE);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await advance(IDLE * 4);
  expect(mock.refresh).not.toHaveBeenCalled();
  expect(reads("versions")).toBe(2);
});

it("refreshes only once when two mounted feeds see the same change", async () => {
  const first = renderHook(() => useLiveRefresh("one"));
  renderHook(() => useLiveRefresh("two"));
  await advance(0);
  versions().splice(0, 1);
  await advance(IDLE + SETTLE);
  expect(mock.refresh).toHaveBeenCalledOnce();
  first.unmount();
  jobs().splice(0, 1);
  await advance(IDLE + SETTLE);
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});

it("refreshes shared queue positions every 15 seconds only while a queued job is due", async () => {
  Object.assign(jobs()[0] as object, { status: "queued", not_before: null });
  renderHook(() => useLiveRefresh("one"));
  renderHook(() => useLiveRefresh("two", ["jobs"]));
  await advance(0);
  for (let count = 1; count <= 3; count++) {
    await advance(IDLE);
    expect(mock.refresh).toHaveBeenCalledTimes(count);
  }
  Object.assign(jobs()[0] as object, {
    not_before: new Date(Date.now() + 100_000).toISOString(),
  });
  await advance(FAST + SETTLE);
  const refreshes = mock.refresh.mock.calls.length;
  await advance(IDLE * 3);
  expect(mock.refresh).toHaveBeenCalledTimes(refreshes);
});

it("notices an edit to a version originally below the newest five", async () => {
  db.tables.versions = Array.from({ length: 8 }, (_, index) => ({
    id: `v${index}`,
    updated_at: `2026-11-01T10:00:0${index}Z`,
  }));
  renderHook(() => useLiveRefresh("data"));
  await advance(0);
  Object.assign(versions()[0] as object, {
    updated_at: "2026-11-01T11:00:00Z",
  });
  await advance(IDLE + SETTLE);
  expect(mock.refresh).toHaveBeenCalledOnce();
});
