import { act, cleanup, render, screen } from "@testing-library/react";
import { Fragment, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeDb } from "@/test/fake-supabase";

const db = fakeDb();
const mock = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => db.client }));

import { LiveTimeline, type TimelineJob } from "./live-timeline";
import { LocaleProvider } from "./locale-provider";

const queued: TimelineJob = {
  id: "j1",
  version_id: "v1",
  stage: "draft_lyrics",
  status: "queued",
  created_at: "2026-01-01",
};
// The stored row behind `queued`, to be changed as the worker would.
const stored = () => db.tables.jobs?.[0] as Record<string, unknown>;
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
    versions: [{ id: "v1", status: "drafting" }],
    jobs: [{ ...queued, error: null, not_before: null }],
    job_events: [],
  };
  db.reads.length = 0;
  db.error = null;
});
afterEach(() => {
  cleanup();
  // An unmounted timeline leaves no poll behind.
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it("collapses a failed attempt that a later attempt replaced", () => {
  const error = "lyric pack validation failed after 3 attempts: title";
  render(
    <LocaleProvider value="it">
      <LiveTimeline
        versionId="v1"
        status="lyrics_review"
        initialJobs={[
          {
            id: "j1",
            version_id: "v1",
            stage: "draft_lyrics",
            status: "failed",
            error,
            created_at: "2026-01-01T10:00:00Z",
          },
          {
            id: "j2",
            version_id: "v1",
            stage: "draft_lyrics",
            status: "done",
            created_at: "2026-01-01T10:05:00Z",
          },
        ]}
        initialEvents={[
          { id: 1, job_id: "j1", message: error, progress: null },
        ]}
      />
    </LocaleProvider>,
  );
  expect(
    screen.getByText("Tentativo precedente non riuscito"),
  ).toBeInTheDocument();
  expect(screen.queryByText(error)).not.toBeInTheDocument();
});
it("keeps technical details of a current failure behind a toggle", () => {
  const error = `lyric pack validation failed after 3 attempts: ${"title: Invalid input; ".repeat(10).trim()}`;
  render(
    <LocaleProvider value="it">
      <LiveTimeline
        versionId="v1"
        status="failed"
        initialJobs={[
          {
            id: "j1",
            version_id: "v1",
            stage: "generate_song",
            status: "failed",
            error,
            created_at: "2026-01-01T10:00:00Z",
          },
        ]}
        initialEvents={[]}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("Dettagli tecnici")).toBeInTheDocument();
  expect(screen.getByText(error).closest("details")).not.toHaveAttribute(
    "open",
  );
});
it("labels stages in plain English", () => {
  render(
    <LocaleProvider value="en">
      <LiveTimeline
        versionId="v1"
        status="drafting"
        initialJobs={[
          {
            id: "j1",
            version_id: "v1",
            stage: "draft_lyrics",
            status: "done",
            created_at: "2026-01-01T10:00:00Z",
          },
        ]}
        initialEvents={[]}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("Lyrics draft")).toBeInTheDocument();
  expect(screen.getByText(/Done/u)).toBeInTheDocument();
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

function timeline(strict = false, jobs: TimelineJob[] = [queued]) {
  const Wrapper = strict ? StrictMode : Fragment;
  const view = (shown: TimelineJob[]) => (
    <Wrapper>
      <LocaleProvider value="en">
        <LiveTimeline
          versionId="v1"
          status="drafting"
          initialJobs={shown}
          initialEvents={[]}
        />
      </LocaleProvider>
    </Wrapper>
  );
  const rendered = render(view(jobs));
  return {
    ...rendered,
    update: (next: TimelineJob[]) => rendered.rerender(view(next)),
  };
}

it("recovers a lower event id committed after another job's higher id", async () => {
  const second: TimelineJob = {
    ...queued,
    id: "j2",
    stage: "generate_song",
    status: "running",
  };
  Object.assign(stored(), { status: "running" });
  db.tables.jobs?.push({ ...second, error: null, not_before: null });
  const late = db.stage("job_events", {
    id: 100,
    job_id: "j1",
    message: "Late final message",
    progress: 100,
    at: "t",
  });
  db.stage("job_events", {
    id: 101,
    job_id: "j2",
    message: "Visible first",
    progress: 50,
    at: "t",
  }).commit();
  timeline(false, [queued, second]);
  await advance(0);
  expect(screen.getByText(/Visible first/)).toBeVisible();
  late.commit();
  await advance(15_000);
  expect(screen.getByText(/Late final message/)).toBeVisible();
});

it.each([false, true])(
  "keeps steady project requests unchanged with active=%s",
  async (active) => {
    const status = active ? "running" : "done";
    Object.assign(stored(), { status });
    timeline(false, [{ ...queued, status }]);
    await advance(0);
    db.reads.length = 0;
    await advance(60_000);
    expect(db.reads).toHaveLength(active ? 90 : 12);
    expect(mock.refresh).not.toHaveBeenCalled();
  },
);

it("keeps in-order event traffic at one cursor and one catch-up page per tick", async () => {
  Object.assign(stored(), { status: "running" });
  timeline(false, [{ ...queued, status: "running" }]);
  await advance(0);
  db.reads.length = 0;
  for (let id = 1; id <= 30; id++) {
    db.stage("job_events", {
      id,
      job_id: "j1",
      message: "Progress",
      progress: id,
      at: "t",
    }).commit();
    await advance(2000);
  }
  expect(db.reads).toHaveLength(120);
});

it("shows quota deferral from a publish job update without a version status change", async () => {
  timeline();
  await advance(0);
  const time = new Date(Date.now() + 86400000).toISOString();
  Object.assign(stored(), { stage: "publish", not_before: time });
  await advance(2000);
  expect(
    screen.getByText(/Waiting for tomorrow's YouTube quota/),
  ).toHaveTextContent(new Date(time).toLocaleString("en"));
  expect(mock.refresh).not.toHaveBeenCalled();
});

it("catches a completed job and version change that occurred before the first read", async () => {
  Object.assign(stored(), { status: "done" });
  Object.assign(db.tables.versions?.[0] as object, { status: "lyrics_review" });
  timeline();
  expect(screen.getByText("Queued")).toBeInTheDocument();
  await advance(0);
  expect(screen.getByText("Done")).toBeInTheDocument();
  expect(mock.refresh).toHaveBeenCalledOnce();
});

it("refreshes the page once when the version status changes and never for a job change", async () => {
  timeline();
  await advance(0);
  Object.assign(stored(), { status: "running" });
  await advance(2000);
  expect(screen.getByText("Running")).toBeInTheDocument();
  expect(mock.refresh).not.toHaveBeenCalled();
  Object.assign(db.tables.versions?.[0] as object, { status: "lyrics_review" });
  await advance(2000);
  expect(mock.refresh).toHaveBeenCalledOnce();
  await advance(10000);
  expect(mock.refresh).toHaveBeenCalledOnce();
});

it("reads every 2 seconds while a job is active and every 15 once none is", async () => {
  const view = timeline();
  await advance(0);
  expect(reads("jobs")).toBe(1);
  await advance(1999);
  expect(reads("jobs")).toBe(1);
  await advance(1);
  expect(reads("jobs")).toBe(2);
  Object.assign(stored(), { status: "done" });
  await advance(2000);
  expect(reads("jobs")).toBe(3);
  expect(screen.getByText("Done")).toBeInTheDocument();
  await advance(14999);
  expect(reads("jobs")).toBe(3);
  await advance(1);
  expect(reads("jobs")).toBe(4);
  view.unmount();
  await advance(60000);
  expect(reads("jobs")).toBe(4);
});

it("reads only this version, its jobs and their events", async () => {
  const view = timeline();
  await advance(0);
  expect(db.reads.map((read) => [read.table, ...read.filters])).toEqual([
    ["versions", "id=eq.v1"],
    ["jobs", "version_id=eq.v1"],
    ["job_events", "job_id=in.(j1)"],
  ]);
  db.reads.length = 0;
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
  expect(screen.queryByText("Lyrics draft")).not.toBeInTheDocument();
  await advance(0);
  expect(db.reads.map((read) => [read.table, ...read.filters])).toEqual([
    ["versions", "id=eq.v2"],
    ["jobs", "version_id=eq.v2"],
  ]);
});

it("shows the progress a running job reports", async () => {
  Object.assign(stored(), { status: "running" });
  timeline(false, [{ ...queued, status: "running" }]);
  await advance(0);
  const before = reads("job_events");
  db.tables.job_events?.push({
    id: 1,
    job_id: "j1",
    message: "Writing the chorus",
    progress: 40,
    at: "2026-01-01T10:00:01Z",
  });
  await advance(2000);
  expect(screen.getByText("Running · 40% · Writing the chorus")).toBeVisible();
  // One read to see the newest id, one to fetch the events.
  expect(reads("job_events")).toBe(before + 2);
  await advance(2000);
  expect(reads("job_events")).toBe(before + 3);
  db.tables.job_events?.push({
    id: 2,
    job_id: "j1",
    message: "Progress: 55%",
    progress: 55,
    at: "2026-01-01T10:00:03Z",
  });
  await advance(2000);
  expect(screen.getByText("Running · 55%")).toBeVisible();
});

it("loads the earlier events of a job that appears later", async () => {
  Object.assign(stored(), { status: "running" });
  db.tables.job_events?.push(
    { id: 3, job_id: "j2", message: "Mixing", progress: 20, at: "t" },
    { id: 5, job_id: "j1", message: "Writing", progress: 80, at: "t" },
  );
  timeline(false, [{ ...queued, status: "running" }]);
  await advance(0);
  expect(screen.getByText("Running · 80% · Writing")).toBeVisible();
  db.tables.jobs?.push({
    ...queued,
    id: "j2",
    stage: "generate_song",
    status: "running",
    created_at: "2026-01-02",
    error: null,
    not_before: null,
  });
  await advance(2000);
  await advance(0);
  expect(screen.getByText("Running · 20% · Mixing")).toBeVisible();
  expect(screen.getByText("Running · 80% · Writing")).toBeVisible();
});

it("checks at once when the window regains focus and stops on unmount", async () => {
  Object.assign(stored(), { status: "done" });
  const view = timeline(false, [{ ...queued, status: "done" }]);
  await advance(0);
  expect(reads("jobs")).toBe(1);
  Object.assign(stored(), { status: "failed", error: "boom" });
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(reads("jobs")).toBe(2);
  expect(screen.getByText("Failed")).toBeInTheDocument();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(reads("jobs")).toBe(2);
});

it("keeps the last timeline while reads fail, backs off and recovers", async () => {
  timeline();
  await advance(0);
  db.error = "connection refused";
  await advance(2000);
  expect(reads("jobs")).toBe(2);
  expect(screen.getByText("Queued")).toBeInTheDocument();
  // After one failure the next read waits twice the interval.
  await advance(3999);
  expect(reads("jobs")).toBe(2);
  db.error = null;
  Object.assign(stored(), { status: "done" });
  await advance(1);
  expect(reads("jobs")).toBe(3);
  expect(screen.getByText("Done")).toBeInTheDocument();
});

it("does not poll while the tab is hidden and catches up when it shows", async () => {
  let visibility = "hidden";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  try {
    timeline();
    await advance(60000);
    expect(db.reads).toHaveLength(0);
    Object.assign(stored(), { status: "done" });
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Done")).toBeInTheDocument();
  } finally {
    Reflect.deleteProperty(document, "visibilityState");
  }
});

it("reads again when the page brings server data older than the timeline shows", async () => {
  const view = timeline();
  await advance(0);
  Object.assign(stored(), { status: "done" });
  await advance(2000);
  expect(screen.getByText("Done")).toBeInTheDocument();
  // A refresh that was answered before the job finished arrives late.
  view.update([{ ...queued }]);
  expect(screen.getByText("Queued")).toBeInTheDocument();
  await advance(0);
  expect(screen.getByText("Done")).toBeInTheDocument();
});

it("keeps one watch through Strict Mode and cleans up on unmount", async () => {
  const view = timeline(true);
  await advance(0);
  expect(reads("jobs")).toBe(1);
  await advance(2000);
  expect(reads("jobs")).toBe(2);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await advance(60000);
  expect(reads("jobs")).toBe(2);
});

it("keeps deferred jobs on the idle clock and speeds up at their due time", async () => {
  const deferred = {
    ...queued,
    not_before: new Date(Date.now() + 20_000).toISOString(),
  };
  Object.assign(stored(), deferred);
  timeline(false, [deferred]);
  await advance(0);
  await advance(14_999);
  expect(reads("jobs")).toBe(1);
  await advance(1);
  expect(reads("jobs")).toBe(2);
  await advance(5_000);
  expect(reads("jobs")).toBe(3);
  await advance(2_000);
  expect(reads("jobs")).toBe(4);
});

it("keeps the last jobs and refreshes once when the version disappears", async () => {
  const view = timeline();
  await advance(0);
  db.tables.versions = [];
  db.tables.jobs = [];
  await advance(2_000);
  expect(screen.getByText("Queued")).toBeVisible();
  expect(mock.refresh).toHaveBeenCalledOnce();
  await advance(60_000);
  expect(mock.refresh).toHaveBeenCalledOnce();
  view.update([]);
  await advance(0);
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  expect(mock.refresh).toHaveBeenCalledOnce();
});

it("catches every job's last progress after more than a page of hidden events", async () => {
  const second: TimelineJob = {
    ...queued,
    id: "j2",
    stage: "generate_song",
    status: "running",
  };
  Object.assign(stored(), { status: "running" });
  db.tables.jobs?.push({ ...second, error: null, not_before: null });
  timeline(false, [{ ...queued, status: "running" }, second]);
  await advance(0);
  db.tables.job_events = Array.from({ length: 251 }, (_, index) => ({
    id: index + 1,
    job_id: index === 0 ? "j1" : "j2",
    message: index === 0 ? "First job caught up" : "Second job caught up",
    progress: index === 0 ? 45 : 90,
    at: "2026-01-01T10:00:00Z",
  }));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText(/45%.*First job caught up/)).toBeVisible();
  expect(screen.getByText(/90%.*Second job caught up/)).toBeVisible();
  const pages = db.reads.filter(
    (read) => read.table === "job_events" && read.columns.includes("message"),
  );
  expect(pages.length).toBeGreaterThan(1);
  expect(pages[0]?.filters).toContain("id=gt.0");
});
