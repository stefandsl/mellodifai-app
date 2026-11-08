import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  readRemake: vi.fn(),
  callbacks: [] as ((payload: { new: Record<string, unknown> }) => void)[],
}));
vi.mock("@/app/actions/remake", () => ({ readRemake: mock.readRemake }));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: async () => ({ data: [] }),
    };
    const channel = {
      on: (
        _event: string,
        _filter: unknown,
        callback: (typeof mock.callbacks)[number],
      ) => {
        mock.callbacks.push(callback);
        return channel;
      },
      subscribe: () => channel,
    };
    return {
      from: () => query,
      channel: () => channel,
      removeChannel: async () => {},
    };
  },
}));

import { useJobEvents } from "./use-job-progress";
import { useRemake } from "./use-remake";

beforeEach(() => {
  mock.readRemake.mockReset();
  mock.callbacks.length = 0;
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

it("clears old job events and ignores a late event after the job changes", async () => {
  const oldEvent = { id: 1, message: "old", progress: 90, at: "2026-11-01" };
  const { result, rerender } = renderHook(
    ({ jobId, initial }) => useJobEvents(jobId, true, initial),
    { initialProps: { jobId: "j1", initial: [oldEvent] } },
  );
  await waitFor(() => expect(mock.callbacks).toHaveLength(1));
  const oldCallback = mock.callbacks[0];
  rerender({ jobId: "j2", initial: [] });
  expect(result.current).toEqual([]);
  act(() => oldCallback?.({ new: { ...oldEvent, job_id: "j1" } }));
  expect(result.current).toEqual([]);
});
