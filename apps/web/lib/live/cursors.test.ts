import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDb } from "@/test/fake-supabase";
import {
  jobEventsWatch,
  jobsWatch,
  readJobEvents,
  timelineWatch,
  versionsWatch,
} from "./cursors";
import type { Watch } from "./poller";

const live = new AbortController().signal;
// What the poller compares between ticks.
const cursor = async <T>(watch: Watch<T>) =>
  JSON.stringify(await watch.read(live));

const version = (id: string, updated_at: string, extra = {}) => ({
  id,
  status: "drafting",
  updated_at,
  ...extra,
});
const job = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  version_id: "v1",
  stage: "draft_lyrics",
  status: "queued",
  created_at: `2026-11-01T10:00:0${id.slice(1)}Z`,
  started_at: null,
  finished_at: null,
  heartbeat_at: null,
  not_before: null,
  error: null,
  ...extra,
});
const row = (rows: Record<string, unknown>[], id: unknown) =>
  rows.find((item) => item.id === id) as Record<string, unknown>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("versions", () => {
  const seed = () =>
    fakeDb({
      versions: [
        version("v1", "2026-11-01T10:00:00Z"),
        version("v2", "2026-11-01T11:00:00Z"),
      ],
    });

  it("moves when a version is added, edited or deleted", async () => {
    const db = seed();
    const watch = versionsWatch(db.client);
    const seen = [await cursor(watch)];
    const moved = async () => {
      const next = await cursor(watch);
      const changed = next !== seen.at(-1);
      seen.push(next);
      return changed;
    };
    expect(await moved()).toBe(false);
    db.tables.versions?.push(version("v3", "2026-11-01T12:00:00Z"));
    expect(await moved()).toBe(true);
    row(db.tables.versions ?? [], "v1").updated_at = "2026-11-01T12:30:00Z";
    expect(await moved()).toBe(true);
    db.tables.versions?.splice(0, 1);
    expect(await moved()).toBe(true);
  });

  it("notices an edit that commits behind a later timestamp", async () => {
    const db = seed();
    const watch = versionsWatch(db.client);
    const before = await cursor(watch);
    // v1's transaction began before v2's last edit and committed after it.
    row(db.tables.versions ?? [], "v1").updated_at = "2026-11-01T10:59:59Z";
    expect(await cursor(watch)).not.toBe(before);
  });

  it("is the same from read to read when many rows share a timestamp", async () => {
    const db = fakeDb({
      versions: ["d", "a", "f", "c", "b", "e", "g"].map((id) =>
        version(id, "2026-11-01T10:00:00Z"),
      ),
    });
    const watch = versionsWatch(db.client);
    const before = await cursor(watch);
    db.tables.versions?.reverse();
    expect(await cursor(watch)).toBe(before);
    expect((await watch.read(live)).newest.map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
});

describe("jobs", () => {
  it("moves on every step of a job's life and on nothing else", async () => {
    const db = fakeDb({ jobs: [job("j1", { status: "done" })] });
    const watch = jobsWatch(db.client);
    let last = await cursor(watch);
    const moved = async () => {
      const next = await cursor(watch);
      const changed = next !== last;
      last = next;
      return changed;
    };
    const jobs = db.tables.jobs ?? [];
    // Queued.
    jobs.push(job("j2"));
    expect(await moved()).toBe(true);
    // Claimed.
    Object.assign(row(jobs, "j2"), {
      status: "running",
      started_at: "2026-11-01T10:01:00Z",
      heartbeat_at: "2026-11-01T10:01:00Z",
    });
    expect(await moved()).toBe(true);
    // A heartbeat is not news.
    row(jobs, "j2").heartbeat_at = "2026-11-01T10:01:30Z";
    expect(await moved()).toBe(false);
    // Put back and deferred.
    Object.assign(row(jobs, "j2"), {
      status: "queued",
      started_at: null,
      heartbeat_at: null,
      not_before: "2026-11-02T00:00:00Z",
    });
    expect(await moved()).toBe(true);
    // Claimed again and finished.
    Object.assign(row(jobs, "j2"), {
      status: "running",
      started_at: "2026-11-02T00:00:01Z",
    });
    expect(await moved()).toBe(true);
    Object.assign(row(jobs, "j2"), {
      status: "done",
      finished_at: "2026-11-02T00:00:09Z",
    });
    expect(await moved()).toBe(true);
    // Deleted with its version.
    jobs.splice(0, 1);
    expect(await moved()).toBe(true);
  });

  it("moves when a job came and went between two reads", async () => {
    const db = fakeDb({ jobs: [] });
    const watch = jobsWatch(db.client);
    const before = await cursor(watch);
    db.tables.jobs?.push(
      job("j1", { status: "failed", finished_at: "2026-11-01T10:00:05Z" }),
    );
    const failed = await cursor(watch);
    expect(failed).not.toBe(before);
    // The same row, tried again and finished before the next read.
    Object.assign(row(db.tables.jobs ?? [], "j1"), {
      status: "done",
      finished_at: "2026-11-01T10:00:20Z",
    });
    expect(await cursor(watch)).not.toBe(failed);
  });

  it("calls queued and running jobs work, but not a job that waits for its time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    const db = fakeDb({ jobs: [job("j1", { status: "done" })] });
    const watch = jobsWatch(db.client);
    const busy = async () => watch.busy?.(await watch.read(live));
    expect(await busy()).toBe(false);
    db.tables.jobs?.push(job("j2"));
    expect(await busy()).toBe(true);
    row(db.tables.jobs ?? [], "j2").not_before = "2026-11-02T00:00:00Z";
    expect(await busy()).toBe(false);
    vi.setSystemTime(new Date("2026-11-02T00:00:01Z"));
    expect(await busy()).toBe(true);
    Object.assign(row(db.tables.jobs ?? [], "j2"), {
      status: "running",
      not_before: "2026-11-03T00:00:00Z",
    });
    expect(await busy()).toBe(true);
  });
});

describe("timeline", () => {
  it("reads one version's status and jobs, oldest first", async () => {
    const db = fakeDb({
      versions: [
        version("v1", "2026-11-01T10:00:00Z", { status: "lyrics_review" }),
        version("v2", "2026-11-01T10:00:00Z"),
      ],
      jobs: [
        job("j2", { error: "boom" }),
        job("j1"),
        job("j3", { version_id: "v2" }),
      ],
    });
    const snapshot = await timelineWatch(db.client, "v1").read(live);
    expect(snapshot.status).toBe("lyrics_review");
    expect(snapshot.jobs).toEqual([
      {
        id: "j1",
        version_id: "v1",
        stage: "draft_lyrics",
        status: "queued",
        created_at: "2026-11-01T10:00:01Z",
        error: null,
        not_before: null,
      },
      {
        id: "j2",
        version_id: "v1",
        stage: "draft_lyrics",
        status: "queued",
        created_at: "2026-11-01T10:00:02Z",
        error: "boom",
        not_before: null,
      },
    ]);
    expect(db.reads.map((read) => [read.table, read.filters])).toEqual([
      ["versions", ["id=eq.v1"]],
      ["jobs", ["version_id=eq.v1"]],
    ]);
  });

  it("has no status for a version that is gone, and one watch per version", async () => {
    const db = fakeDb({ versions: [], jobs: [] });
    expect(await timelineWatch(db.client, "v1").read(live)).toEqual({
      status: null,
      jobs: [],
    });
    expect(timelineWatch(db.client, "v1").key).not.toBe(
      timelineWatch(db.client, "v2").key,
    );
  });
});

describe("job events", () => {
  const event = (id: number, job_id: string) => ({
    id,
    job_id,
    message: `m${id}`,
    progress: id,
    at: "2026-11-01T10:00:00Z",
    level: "info",
  });

  it("follows the newest event of the watched jobs only", async () => {
    const db = fakeDb({ job_events: [event(1, "j1"), event(2, "j9")] });
    const watch = jobEventsWatch(db.client, ["j2", "j1"]);
    expect(await watch.read(live)).toEqual({ newest: 1 });
    db.tables.job_events?.push(event(3, "j9"));
    expect(await watch.read(live)).toEqual({ newest: 1 });
    db.tables.job_events?.push(event(4, "j2"));
    expect(await watch.read(live)).toEqual({ newest: 4 });
    expect(await jobEventsWatch(db.client, ["j7"]).read(live)).toEqual({
      newest: null,
    });
  });

  it("is one watch for the same jobs in any order", () => {
    const db = fakeDb();
    expect(jobEventsWatch(db.client, ["j2", "j1"]).key).toBe(
      jobEventsWatch(db.client, ["j1", "j2"]).key,
    );
  });

  it("reads the latest events oldest first", async () => {
    const db = fakeDb({
      job_events: [1, 2, 3, 4, 5].map((id) =>
        event(id, id === 3 ? "j9" : "j1"),
      ),
    });
    expect(await readJobEvents(db.client, ["j1"], 3)).toEqual(
      [2, 4, 5].map((id) => {
        const { level: _level, ...shown } = event(id, "j1");
        return shown;
      }),
    );
  });
});

it("rejects when a read fails, so the poller backs off", async () => {
  const db = fakeDb({ versions: [], jobs: [], job_events: [] });
  db.error = "permission denied";
  for (const watch of [
    versionsWatch(db.client),
    jobsWatch(db.client),
    timelineWatch(db.client, "v1"),
    jobEventsWatch(db.client, ["j1"]),
  ])
    await expect(watch.read(live)).rejects.toThrow("permission denied");
  await expect(readJobEvents(db.client, ["j1"], 5)).rejects.toThrow(
    "permission denied",
  );
});

// The real client, with the network replaced: what the cursors ask PostgREST for.
describe("requests", () => {
  function client(rows: unknown = [], total = 0) {
    const requests: { url: URL; headers: Headers; signal: AbortSignal }[] = [];
    const socket = vi.fn();
    vi.stubGlobal("WebSocket", socket);
    const db = createClient("http://127.0.0.1:54321", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const signal = init?.signal as AbortSignal;
          signal?.throwIfAborted();
          requests.push({
            url: new URL(String(input)),
            headers: new Headers(init?.headers),
            signal,
          });
          return new Response(JSON.stringify(rows), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-range": `0-0/${total}`,
            },
          });
        },
      },
    });
    const sent = () =>
      requests.map(({ url, headers }) => ({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        count: headers.get("prefer")?.includes("count=exact") ?? false,
      }));
    return { db, sent, socket };
  }

  it("asks for the newest versions and their exact count", async () => {
    const newest = [{ id: "v1", updated_at: "2026-11-01T10:00:00Z" }];
    const { db, sent } = client(newest, 37);
    expect(await versionsWatch(db).read(live)).toEqual({ count: 37, newest });
    expect(sent()).toEqual([
      {
        path: "/rest/v1/versions",
        query: {
          select: "id,updated_at",
          order: "updated_at.desc,id.asc",
          limit: "5",
        },
        count: true,
      },
    ]);
  });

  it("asks for the active jobs, the latest finished ones and the exact count", async () => {
    const { db, sent } = client([], 12);
    expect(await jobsWatch(db).read(live)).toEqual({
      count: 12,
      active: [],
      finished: [],
    });
    expect(sent()).toEqual([
      {
        path: "/rest/v1/jobs",
        query: {
          select: "id,status,started_at,not_before",
          status: "in.(queued,running)",
          order: "id.asc",
        },
        count: false,
      },
      {
        path: "/rest/v1/jobs",
        query: {
          select: "id,status,finished_at",
          order: "finished_at.desc.nullslast,id.asc",
          limit: "5",
        },
        count: true,
      },
    ]);
  });

  it("asks for one version's status and jobs", async () => {
    const { db, sent } = client([]);
    expect(await timelineWatch(db, "v1").read(live)).toEqual({
      status: null,
      jobs: [],
    });
    expect(sent()).toEqual([
      {
        path: "/rest/v1/versions",
        query: { select: "status", id: "eq.v1" },
        count: false,
      },
      {
        path: "/rest/v1/jobs",
        query: {
          select: "id,version_id,stage,status,created_at,error,not_before",
          version_id: "eq.v1",
          order: "created_at.asc,id.asc",
        },
        count: false,
      },
    ]);
  });

  it("asks for the newest event id, then for the latest events", async () => {
    const { db, sent } = client([{ id: 7 }]);
    expect(await jobEventsWatch(db, ["j2", "j1"]).read(live)).toEqual({
      newest: 7,
    });
    await readJobEvents(db, ["j1", "j2"], 50);
    expect(sent()).toEqual([
      {
        path: "/rest/v1/job_events",
        query: {
          select: "id",
          job_id: "in.(j1,j2)",
          order: "id.desc",
          limit: "1",
        },
        count: false,
      },
      {
        path: "/rest/v1/job_events",
        query: {
          select: "id,job_id,message,progress,at",
          job_id: "in.(j1,j2)",
          order: "id.desc",
          limit: "50",
        },
        count: false,
      },
    ]);
  });

  it("stops a read whose signal aborts and never opens a socket", async () => {
    const { db, sent, socket } = client([]);
    const controller = new AbortController();
    controller.abort();
    for (const watch of [
      versionsWatch(db),
      jobsWatch(db),
      timelineWatch(db, "v1"),
      jobEventsWatch(db, ["j1"]),
    ]) {
      await expect(watch.read(controller.signal)).rejects.toThrow();
      await watch.read(live);
    }
    expect(sent()).toHaveLength(6);
    expect(socket).not.toHaveBeenCalled();
  });
});
