import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  handlers: [] as {
    filter: Record<string, string>;
    callback: (p: { new: Record<string, unknown> }) => void;
  }[],
  refresh: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => {
    const query = {
      select: () => query,
      in: () => query,
      order: () => query,
      limit: () => Promise.resolve({ data: [] }),
    };
    return {
      from: () => query,
      removeChannel: mock.remove,
      channel: () => {
        const channel = {
          on: (
            _type: string,
            filter: Record<string, string>,
            callback: (p: { new: Record<string, unknown> }) => void,
          ) => {
            mock.handlers.push({ filter, callback });
            return channel;
          },
          subscribe: () => channel,
        };
        return channel;
      },
    };
  },
}));

import { LiveTimeline } from "./live-timeline";
import { LocaleProvider } from "./locale-provider";
import { WorkerBadge } from "./worker-badge";

beforeEach(() => {
  mock.handlers.length = 0;
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());
it("scopes subscriptions and refreshes only when version status changes", async () => {
  const view = render(
    <LocaleProvider value="en">
      <LiveTimeline
        key="v1"
        versionId="v1"
        status="drafting"
        initialJobs={[
          {
            id: "j1",
            version_id: "v1",
            stage: "draft_lyrics",
            status: "queued",
            created_at: "2026-01-01",
          },
        ]}
        initialEvents={[]}
      />
    </LocaleProvider>,
  );
  const inserts = mock.handlers.find(
    (h) => h.filter.table === "jobs" && h.filter.event === "INSERT",
  );
  expect(inserts?.filter.filter).toBe("version_id=eq.v1");
  expect(
    mock.handlers.some(
      (h) => h.filter.event === "*" || h.filter.event === "DELETE",
    ),
  ).toBe(false);
  expect(
    mock.handlers.find((h) => h.filter.table === "job_events")?.filter.filter,
  ).toBe("job_id=in.(j1)");
  act(() =>
    inserts?.callback({
      new: {
        id: "foreign",
        version_id: "v2",
        stage: "publish",
        status: "done",
        created_at: "2026-01-02",
      },
    }),
  );
  expect(screen.queryByText("publish")).not.toBeInTheDocument();
  const version = mock.handlers.find((h) => h.filter.table === "versions");
  act(() => version?.callback({ new: { id: "v1", status: "drafting" } }));
  expect(mock.refresh).not.toHaveBeenCalled();
  act(() => version?.callback({ new: { id: "v1", status: "lyrics_review" } }));
  expect(mock.refresh).toHaveBeenCalledOnce();
  view.rerender(
    <LocaleProvider value="en">
      <LiveTimeline
        key="v2"
        versionId="v2"
        status="producing"
        initialJobs={[]}
        initialEvents={[]}
      />
    </LocaleProvider>,
  );
  expect(screen.queryByText("draft lyrics")).not.toBeInTheDocument();
  expect(mock.remove).toHaveBeenCalled();
  await waitFor(() =>
    expect(
      mock.handlers.some((h) => h.filter.filter === "version_id=eq.v2"),
    ).toBe(true),
  );
});
it("worker heartbeat expires on the 15 second clock and realtime restores it with balance", () => {
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
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByText(/Offline since/)).toBeInTheDocument();
  const handler = mock.handlers.find((h) => h.filter.table === "workers");
  expect(handler?.filter.filter).toBe("id=eq.pc");
  act(() =>
    handler?.callback({
      new: {
        last_seen: new Date().toISOString(),
        busy_job_id: "job",
        kie_balance: 24,
      },
    }),
  );
  expect(screen.getByText("Busy")).toBeInTheDocument();
  expect(screen.getByText("kie balance: 24")).toBeInTheDocument();
});
