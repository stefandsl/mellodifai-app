import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { usePlayer } from "@/store/player";
import { KaraokeView } from "./karaoke-view";

type JobRow = {
  id: string;
  version_id: string;
  stage: string;
  status: string;
  payload: Record<string, string>;
};
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  single: vi.fn(),
  lookup: vi.fn(),
  jobs: [] as JobRow[],
}));
// The job lookup reads this small in-memory jobs table with the filters the view sends.
function matches(row: JobRow, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([column, value]) => {
    const field = column.startsWith("payload->>")
      ? row.payload[column.slice("payload->>".length)]
      : row[column as keyof JobRow];
    return Array.isArray(value) ? value.includes(field) : field === value;
  });
}
vi.mock("@/app/actions/align-lyrics", () => ({
  requestLyricAlignment: mocks.request,
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const rows = () => {
          mocks.lookup(table, { ...filters });
          return mocks.jobs.filter((row) => matches(row, filters));
        };
        const query = {
          eq: (column: string, value: string) => {
            filters[column] = value;
            return query;
          },
          in: (column: string, values: string[]) => {
            filters[column] = values;
            return Promise.resolve({ data: rows(), error: null });
          },
          maybeSingle: () =>
            Promise.resolve({ data: rows()[0] ?? null, error: null }),
          single: () => mocks.single(table, filters.id),
        };
        return query;
      },
    }),
  }),
}));
const TIMING = {
  source: "whisper",
  lines: [{ text: "Hello world", start: 0, end: 2 }],
};
function alignJob(
  id: string,
  status: string,
  payload: Record<string, string>,
  versionId = "one",
): JobRow {
  return { id, version_id: versionId, stage: "align_lyrics", status, payload };
}
function track(id: string) {
  return {
    id,
    title: id,
    subtitle: "IT",
    audioUrl: "audio.wav",
    videoUrl: null,
    href: "/",
    art: "red",
    reaction: "none" as const,
    detail: {
      own: {
        title: id,
        subtitle: "IT",
        videoUrl: null,
        reaction: "none" as const,
      },
      songId: id,
      lyrics: "Hello world",
      style: "pop",
      createdAt: "",
      chosenTakeId: `${id}-take`,
      playbackTakeId: `${id}-take`,
      takes: [{ id: `${id}-take`, number: 1, audioUrl: "audio.wav" }],
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  usePlayer.setState({
    queue: [track("one"), track("two")],
    index: 0,
    showLyrics: true,
    time: 0,
  });
  mocks.jobs = [];
  mocks.single.mockImplementation(async (table) => ({
    data: table === "jobs" ? { status: "running" } : { lyric_timing: null },
    error: null,
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function stubLayoutGlobals() {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
}
function mount() {
  render(
    <LocaleProvider value="it">
      <KaraokeView />
    </LocaleProvider>,
  );
}
it("restores retry when the server action rejects", async () => {
  mocks.request.mockRejectedValue(new Error("offline"));
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  ).toBeEnabled();
});
it.each(["failed", "cancelled", "done"])(
  "restores retry after terminal job status %s",
  async (status) => {
    mocks.request.mockResolvedValue({ ok: true, id: "job-one" });
    mocks.single.mockImplementation(async (table) => ({
      data: table === "jobs" ? { status } : { lyric_timing: null },
      error: null,
    }));
    mount();
    await userEvent.click(
      screen.getByRole("button", { name: "Sincronizza testo" }),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Sincronizza testo" }),
    ).toBeEnabled();
  },
);
it("ignores stale polls when switching songs and allows the new song to sync", async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.request.mockResolvedValue({ ok: true, id: "job-one" });
  mocks.single.mockImplementation((table) =>
    table === "takes"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ data: { status: "running" } }),
  );
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  await waitFor(() =>
    expect(mocks.single).toHaveBeenCalledWith("takes", "one-take"),
  );
  act(() => usePlayer.setState({ index: 1 }));
  expect(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  ).toBeEnabled();
  await act(async () =>
    finish({
      data: {
        lyric_timing: {
          source: "whisper",
          lines: [{ text: "Hello world", start: 0, end: 2 }],
        },
      },
    }),
  );
  expect(
    usePlayer.getState().queue[1]?.detail?.takes[0]?.timing,
  ).toBeUndefined();
  expect(mocks.single).not.toHaveBeenCalledWith("takes", "two-take");
});

it("ignores a request response after changing takes", async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  act(() =>
    usePlayer.setState((state) => ({
      queue: state.queue.map((item, index) =>
        index !== 0 || !item.detail
          ? item
          : {
              ...item,
              detail: {
                ...item.detail,
                takeNumber: 2,
                playbackTakeId: "another-take",
                takes: [
                  ...item.detail.takes,
                  { id: "another-take", number: 2, audioUrl: "audio.wav" },
                ],
              },
            },
      ),
    })),
  );
  expect(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  ).toBeEnabled();
  await act(async () => finish({ ok: true, id: "old-job" }));
  expect(mocks.single).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  ).toBeEnabled();
});

it("highlights the first measured word despite leading whitespace and missing lines", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  const item = track("spaced");
  usePlayer.setState({
    queue: [
      {
        ...item,
        detail: {
          ...item.detail,
          lyrics: "  Hello world  \nMissing lyric",
          takes: [
            {
              ...item.detail.takes[0],
              id: "spaced-take",
              number: 1,
              audioUrl: "audio.wav",
              timing: {
                source: "whisper",
                lines: [
                  {
                    text: "Hello world",
                    start: 0,
                    end: 2,
                    words: [
                      { word: "Hello", start: 0, end: 0.5 },
                      { word: "world", start: 1, end: 2 },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    ],
    index: 0,
    time: 0.2,
  });
  mount();
  expect(screen.getByText("Hello", { exact: true })).toHaveClass(
    "text-[var(--brand)]",
  );
  expect(screen.getByText("world", { exact: true })).not.toHaveClass(
    "text-[var(--brand)]",
  );
  act(() => usePlayer.setState({ time: 1.2 }));
  expect(screen.getByText("world", { exact: true })).toHaveClass(
    "text-[var(--brand)]",
  );
  vi.unstubAllGlobals();
});

it("uses the playable take ID when the first take has no audio", () => {
  const item = track("fallback");
  usePlayer.setState({
    queue: [
      {
        ...item,
        detail: {
          ...item.detail,
          chosenTakeId: null,
          playbackTakeId: "playable",
          takes: [
            { id: "silent", number: 1, audioUrl: null, lyrics: "Wrong words" },
            {
              id: "playable",
              number: 2,
              audioUrl: "audio.wav",
              lyrics: "Right words",
            },
          ],
        },
      },
    ],
    index: 0,
  });
  mount();
  expect(screen.getByRole("button", { name: "Right words" })).toBeVisible();
  expect(screen.queryByText("Wrong words")).not.toBeInTheDocument();
});

it("queues and receives alignment for a master-only song", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  const item = track("master");
  usePlayer.setState({
    queue: [
      {
        ...item,
        detail: {
          ...item.detail,
          playbackTakeId: null,
          takes: [{ id: "silent", number: 1, audioUrl: null }],
        },
      },
    ],
    index: 0,
  });
  mocks.request.mockResolvedValue({ ok: true, id: "master-job" });
  mocks.single.mockImplementation(async (table) => ({
    data:
      table === "versions"
        ? {
            lyric_timing: {
              source: "whisper",
              lines: [{ text: "Hello world", start: 0, end: 2 }],
            },
          }
        : { status: "done" },
    error: null,
  }));
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  await waitFor(() =>
    expect(mocks.single).toHaveBeenCalledWith("versions", "master"),
  );
  await waitFor(() =>
    expect(usePlayer.getState().queue[0]?.detail?.timing).toBeTruthy(),
  );
  expect(mocks.request).toHaveBeenCalledWith({
    versionId: "master",
    takeId: null,
  });
  vi.unstubAllGlobals();
});

it("keeps polling after transient poll failures until lyric timing arrives", async () => {
  stubLayoutGlobals();
  vi.useFakeTimers();
  mocks.request.mockResolvedValue({ ok: true, id: "job-one" });
  // The poll runs every 3 s; the fake clock tells which poll a read belongs to,
  // whatever order the view reads the two rows in.
  const start = Date.now();
  mocks.single.mockImplementation(async (table) => {
    const pollAttempt = Math.floor((Date.now() - start) / 3000) + 1;
    if (pollAttempt === 1) throw new Error("aborted");
    if (pollAttempt === 2) {
      return { data: null, error: new Error("temporary failure") };
    }
    return {
      data:
        table === "takes"
          ? {
              lyric_timing: {
                source: "whisper",
                lines: [{ text: "Hello world", start: 0, end: 2 }],
              },
            }
          : { status: "done" },
      error: null,
    };
  });
  mount();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sincronizza testo" }));
    await Promise.resolve();
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Sincronizzazione in corso..." }),
  ).toBeDisabled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Sincronizzazione in corso..." }),
  ).toBeDisabled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(usePlayer.getState().queue[0]?.detail?.takes[0]?.timing).toBeTruthy();
  expect(screen.getByRole("button", { name: "Hello world" })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("gives up only after 5 consecutive poll failures and resets the count on success", async () => {
  vi.useFakeTimers();
  mocks.request.mockResolvedValue({ ok: true, id: "job-one" });
  const start = Date.now();
  mocks.single.mockImplementation(async (table) => {
    const pollAttempt = Math.floor((Date.now() - start) / 3000) + 1;
    if (pollAttempt === 5) {
      return {
        data: table === "jobs" ? { status: "running" } : { lyric_timing: null },
        error: null,
      };
    }
    throw new Error("offline");
  });
  mount();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sincronizza testo" }));
    await Promise.resolve();
  });
  // Attempts 1..4 fail, attempt 5 succeeds (resets streak), attempts 6..9 fail: still polling.
  for (let tick = 0; tick < 8; tick += 1) {
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
  }
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Sincronizzazione in corso..." }),
  ).toBeDisabled();
  // Attempt 10 is the 5th consecutive failure since attempt 5 succeeded.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.getByRole("alert")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  ).toBeEnabled();
});

it("polls an existing open align_lyrics job for the take when the action response is lost", async () => {
  stubLayoutGlobals();
  mocks.request.mockRejectedValue(new Error("aborted"));
  mocks.jobs = [
    alignJob("other-take-job", "running", { take_id: "other-take" }),
    alignJob("recovered-take-job", "running", { take_id: "one-take" }),
  ];
  mocks.single.mockImplementation(async (table) => ({
    data: table === "takes" ? { lyric_timing: TIMING } : { status: "done" },
    error: null,
  }));
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  await waitFor(() =>
    expect(mocks.single).toHaveBeenCalledWith("jobs", "recovered-take-job"),
  );
  await waitFor(() =>
    expect(
      usePlayer.getState().queue[0]?.detail?.takes[0]?.timing,
    ).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "Hello world" })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("polls an existing open master align_lyrics job when the action fails", async () => {
  stubLayoutGlobals();
  const item = track("master");
  usePlayer.setState({
    queue: [
      {
        ...item,
        detail: {
          ...item.detail,
          playbackTakeId: null,
          takes: [{ id: "silent", number: 1, audioUrl: null }],
        },
      },
    ],
    index: 0,
  });
  mocks.request.mockResolvedValue({ ok: false, error: "failed" });
  mocks.jobs = [
    alignJob("take-job", "running", { take_id: "silent" }, "master"),
    alignJob("recovered-master-job", "queued", { source: "master" }, "master"),
  ];
  mocks.single.mockImplementation(async (table) => ({
    data:
      table === "versions"
        ? {
            lyric_timing: {
              source: "whisper",
              lines: [{ text: "Hello world", start: 0, end: 2 }],
            },
          }
        : { status: "done" },
    error: null,
  }));
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  await waitFor(() =>
    expect(mocks.single).toHaveBeenCalledWith("jobs", "recovered-master-job"),
  );
  await waitFor(() =>
    expect(usePlayer.getState().queue[0]?.detail?.timing).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "Hello world" })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

// Review round 1, finding 1. The worker writes the timing and then marks the job done in a
// second step. Here both writes land right after the first timing read of the first poll,
// so a poll that reads both in parallel sees `done` with no timing.
it("does not fail when the job turns done between the timing read and the status read", async () => {
  stubLayoutGlobals();
  vi.useFakeTimers();
  mocks.request.mockResolvedValue({ ok: true, id: "job-one" });
  let workerFinished = false;
  mocks.single.mockImplementation(async (table) => {
    if (table === "takes") {
      const lyric_timing = workerFinished ? TIMING : null;
      workerFinished = true;
      return { data: { lyric_timing }, error: null };
    }
    return {
      data: { status: workerFinished ? "done" : "running" },
      error: null,
    };
  });
  mount();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sincronizza testo" }));
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(usePlayer.getState().queue[0]?.detail?.takes[0]?.timing).toBeTruthy();
  expect(screen.getByRole("button", { name: "Hello world" })).toBeEnabled();
});

// Review round 1, finding 2. The action response is lost and the job is already done when
// the view looks it up; the timing exists.
it("polls the job of the take when the action response is lost and the job is already done", async () => {
  stubLayoutGlobals();
  mocks.request.mockRejectedValue(new Error("aborted"));
  mocks.jobs = [alignJob("done-take-job", "done", { take_id: "one-take" })];
  mocks.single.mockImplementation(async (table) => ({
    data: table === "takes" ? { lyric_timing: TIMING } : { status: "done" },
    error: null,
  }));
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  await waitFor(() => expect(mocks.lookup).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      usePlayer.getState().queue[0]?.detail?.takes[0]?.timing,
    ).toBeTruthy(),
  );
  expect(mocks.single).toHaveBeenCalledWith("jobs", "done-take-job");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
