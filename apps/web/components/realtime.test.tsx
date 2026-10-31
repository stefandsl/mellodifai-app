import { act, render, screen, waitFor } from "@testing-library/react";
import { Fragment, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type FakeChannel = {
  topic: string;
  joined: boolean;
  on(
    type: string,
    filter: Record<string, string>,
    callback: (p: { new: Record<string, unknown> }) => void,
  ): FakeChannel;
  subscribe(callback?: (status: string) => void): FakeChannel;
};

const mock = vi.hoisted(() => ({
  handlers: [] as {
    filter: Record<string, string>;
    callback: (p: { new: Record<string, unknown> }) => void;
  }[],
  refresh: vi.fn(),
  remove: vi.fn(),
  subscribed: [] as ((status: string) => void)[],
  readVersion: vi.fn(),
  readJobs: vi.fn(),
  channels: new Map<string, FakeChannel>(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => ({
        ...query,
        // biome-ignore lint/suspicious/noThenProperty: PostgREST builders are awaitable queries.
        then: (resolve: (value: unknown) => void) => resolve(mock.readJobs()),
      }),
      limit: () => Promise.resolve({ data: [] }),
      single: () => Promise.resolve(mock.readVersion()),
    };
    return {
      from: () => query,
      removeChannel: mock.remove,
      channel: (topic: string) => {
        const existing = mock.channels.get(topic);
        if (existing) return existing;
        const channel: FakeChannel = {
          topic,
          joined: false,
          on: (
            _type: string,
            filter: Record<string, string>,
            callback: (p: { new: Record<string, unknown> }) => void,
          ) => {
            if (channel.joined)
              throw new Error(
                "cannot add postgres_changes callbacks after subscribe()",
              );
            mock.handlers.push({ filter, callback });
            return channel;
          },
          subscribe: (callback?: (status: string) => void) => {
            channel.joined = true;
            if (callback) mock.subscribed.push(callback);
            return channel;
          },
        };
        // Retain registrations to simulate delayed or failed removeChannel calls.
        mock.channels.set(topic, channel);
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
  mock.subscribed.length = 0;
  mock.channels.clear();
  vi.clearAllMocks();
  mock.readVersion.mockReturnValue({ data: { status: "drafting" } });
  mock.readJobs.mockReturnValue({ data: [] });
});
it("explains imported versions without rendering an empty timeline list", () => {
  render(
    <LocaleProvider value="it">
      <LiveTimeline
        versionId="imported"
        status="approved"
        initialJobs={[]}
        initialEvents={[]}
      />
    </LocaleProvider>,
  );
  expect(
    screen.getByText("Importato dal progetto originale"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});
afterEach(() => vi.useRealTimers());
function timeline(strict = false) {
  const Wrapper = strict ? StrictMode : Fragment;
  return render(
    <Wrapper>
      <LocaleProvider value="en">
        <LiveTimeline
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
      </LocaleProvider>
    </Wrapper>,
  );
}
it("uses distinct channel objects through Strict Mode, retry, and unmount", async () => {
  vi.useFakeTimers();
  mock.readJobs.mockReturnValue({
    data: [
      {
        id: "j1",
        version_id: "v1",
        stage: "draft_lyrics",
        status: "queued",
        created_at: "2026-01-01",
      },
    ],
  });
  const view = timeline(true);
  await act(async () => {});
  const initial = [...mock.channels.values()];
  expect(
    initial.filter((channel) => channel.topic.startsWith("version:")),
  ).toHaveLength(2);
  expect(
    initial.filter((channel) => channel.topic.startsWith("events:")),
  ).toHaveLength(2);
  const callbacks = mock.subscribed.slice(-2);
  await act(async () => {
    for (const callback of callbacks) callback("CHANNEL_ERROR");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(mock.channels.size).toBe(6);
  view.unmount();
  await act(async () => {});
  for (const channel of mock.channels.values()) {
    expect(
      mock.remove.mock.calls.filter(([removed]) => removed === channel),
    ).toHaveLength(1);
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(mock.channels.size).toBe(6);
});
it("catches a completed job and version change that occurred before SUBSCRIBED", async () => {
  mock.readVersion.mockReturnValue({ data: { status: "lyrics_review" } });
  mock.readJobs.mockReturnValue({
    data: [
      {
        id: "j1",
        version_id: "v1",
        stage: "draft_lyrics",
        status: "done",
        created_at: "2026-01-01",
      },
    ],
  });
  timeline();
  await act(async () => mock.subscribed[0]?.("SUBSCRIBED"));
  expect(mock.readVersion).toHaveBeenCalled();
  expect(mock.refresh).toHaveBeenCalledOnce();
  expect(screen.getByText("done")).toBeInTheDocument();
});
it("polls active jobs every five seconds and stops once none remain", async () => {
  vi.useFakeTimers();
  mock.readJobs.mockReturnValue({
    data: [
      {
        id: "j1",
        version_id: "v1",
        stage: "draft_lyrics",
        status: "running",
        created_at: "2026-01-01",
      },
    ],
  });
  const view = timeline();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mock.readJobs).toHaveBeenCalledOnce();
  mock.readJobs.mockReturnValue({ data: [] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mock.readJobs).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(mock.readJobs).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mock.readJobs).toHaveBeenCalledTimes(2);
});
it.each(["CHANNEL_ERROR", "TIMED_OUT"])(
  "refetches and resubscribes after %s, and cleans up on unmount",
  async (state) => {
    vi.useFakeTimers();
    const view = timeline();
    const count = mock.subscribed.length;
    await act(async () => mock.subscribed[0]?.(state));
    expect(mock.readVersion).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mock.remove).toHaveBeenCalled();
    expect(mock.subscribed.length).toBe(count + 1);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mock.readVersion).toHaveBeenCalledTimes(2);
    view.unmount();
    const reads = mock.readVersion.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mock.readVersion).toHaveBeenCalledTimes(reads);
  },
);
it("queues concurrent SUBSCRIBED catch-up requests once", async () => {
  let resolve: (value: unknown) => void = () => {};
  mock.readVersion.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  timeline();
  await act(async () => {
    mock.subscribed[0]?.("SUBSCRIBED");
    mock.subscribed[0]?.("SUBSCRIBED");
    mock.subscribed[0]?.("SUBSCRIBED");
  });
  expect(mock.readVersion).toHaveBeenCalledOnce();
  await act(async () => {
    resolve({ data: { status: "drafting" } });
  });
  expect(mock.readVersion).toHaveBeenCalledTimes(2);
});
it("backs off to 30 seconds and retries after channel removal rejects", async () => {
  vi.useFakeTimers();
  mock.remove.mockRejectedValue(new Error("disconnected"));
  const view = timeline();
  let callback: ((status: string) => void) | undefined = mock.subscribed[0];
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const count = mock.subscribed.length;
    await act(async () => callback?.("CHANNEL_ERROR"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(delay - 1);
    });
    expect(mock.subscribed.length).toBe(count);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mock.subscribed.length).toBe(count + 1);
    callback = mock.subscribed.at(-1);
  }
  await act(async () => callback?.("SUBSCRIBED"));
  const count = mock.subscribed.length;
  await act(async () => callback?.("TIMED_OUT"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(mock.subscribed.length).toBe(count + 1);
  view.unmount();
  await act(async () => {});
  mock.remove.mockReset();
});
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
  await waitFor(() => expect(mock.remove).toHaveBeenCalled());
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
