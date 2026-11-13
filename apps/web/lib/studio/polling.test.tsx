import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeDb } from "@/test/fake-supabase";

const db = fakeDb();
const mock = vi.hoisted(() => ({ readRemake: vi.fn() }));
vi.mock("@/app/actions/remake", () => ({ readRemake: mock.readRemake }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => db.client }));

import { type JobEvent, useJobEvents } from "./use-job-progress";
import { useRemake } from "./use-remake";

const event = (id: number, job_id: string, progress = id) => ({
  id,
  job_id,
  message: `step ${id}`,
  progress,
  at: `2026-11-01T10:00:0${id}Z`,
});
const reads = () => db.reads.length;
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  mock.readRemake.mockReset();
  db.tables = { job_events: [] };
  db.reads.length = 0;
  db.error = null;
  db.gate = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shows a completed remake poll while a newer poll is still pending", async () => {
  let finishFirst!: (value: unknown) => void;
  mock.readRemake
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockImplementationOnce(() => new Promise(() => {}));
  const { result } = renderHook(() => useRemake());
  await act(async () => {
    void result.current.refresh();
  });
  await act(async () => {
    finishFirst({
      ok: true,
      data: { remake: { id: "first" }, job: null, failedJob: null },
    });
  });
  expect(result.current.view?.id).toBe("first");
  expect(result.current.loaded).toBe(true);
});

it("follows a job's events every two seconds, fetching them only when there are new ones", async () => {
  vi.useFakeTimers();
  db.tables.job_events = [event(1, "j1"), event(2, "other")];
  const { result, unmount } = renderHook(() => useJobEvents("j1", true));
  expect(result.current).toEqual([]);
  await advance(0);
  // One read for the newest id, one for the events.
  expect(reads()).toBe(2);
  expect(result.current.map((item) => item.id)).toEqual([1]);
  await advance(2000);
  expect(reads()).toBe(3);
  db.tables.job_events.push(event(3, "j1"), event(4, "j1"));
  await advance(1999);
  expect(reads()).toBe(3);
  await advance(1);
  expect(reads()).toBe(5);
  expect(result.current.map((item) => item.id)).toEqual([1, 3, 4]);
  expect(db.reads.every((read) => read.filters[0] === "job_id=in.(j1)")).toBe(
    true,
  );
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  db.tables.job_events.push(event(5, "j1"));
  await advance(60000);
  expect(reads()).toBe(5);
});

it("does not follow a job that is not active", async () => {
  vi.useFakeTimers();
  db.tables.job_events = [event(1, "j1")];
  const initial: JobEvent[] = [];
  const { result } = renderHook(() => useJobEvents("j1", false, initial));
  await advance(60000);
  expect(reads()).toBe(0);
  expect(result.current).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the events the page came with and adds the new ones", async () => {
  vi.useFakeTimers();
  const initial = [event(1, "j1"), event(2, "j1")];
  db.tables.job_events = [...initial, event(3, "j1")];
  const { result } = renderHook(() => useJobEvents("j1", true, initial));
  expect(result.current.map((item) => item.id)).toEqual([1, 2]);
  await advance(0);
  expect(result.current.map((item) => item.id)).toEqual([1, 2, 3]);
});

it("fetches the events again when the fetch after a new id failed", async () => {
  vi.useFakeTimers();
  db.tables.job_events = [event(1, "j1")];
  let failures = 1;
  // The newest-id read answers; the fetch of the events fails once.
  db.gate = async (read) => {
    db.error = read.columns !== "id" && failures-- > 0 ? "network" : null;
  };
  const { result } = renderHook(() => useJobEvents("j1", true));
  await advance(0);
  expect(result.current).toEqual([]);
  await advance(2000);
  expect(result.current.map((item) => item.id)).toEqual([1]);
});

it("clears old job events and ignores a late answer after the job changes", async () => {
  vi.useFakeTimers();
  const oldEvent = event(1, "j1", 90);
  db.tables.job_events = [oldEvent, event(2, "j1", 95)];
  let release: () => void = () => {};
  // The first job's event fetch stays unanswered until the job has changed.
  db.gate = (read) =>
    read.columns !== "id" && read.filters[0] === "job_id=in.(j1)"
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve();
  const rendered: number[][] = [];
  const { result, rerender } = renderHook(
    ({ jobId, initial }) => {
      const events = useJobEvents(jobId, true, initial);
      rendered.push(events.map((item) => item.id));
      return events;
    },
    { initialProps: { jobId: "j1", initial: [oldEvent] as JobEvent[] } },
  );
  await advance(0);
  expect(reads()).toBe(2);
  const beforeChange = rendered.length;
  rerender({ jobId: "j2", initial: [] });
  expect(rendered.slice(beforeChange)).not.toContainEqual([oldEvent.id]);
  expect(result.current).toEqual([]);
  await act(async () => {
    release();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(result.current).toEqual([]);
});
