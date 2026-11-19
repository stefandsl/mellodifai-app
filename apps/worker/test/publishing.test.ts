import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDb } from "../src/db.js";
import { WorkerLoop } from "../src/loop.js";
import { startPublishing } from "../src/main.js";
import {
  type Claim,
  type DispatchDb,
  dispatchTick,
  type Outcome,
} from "../src/publishing/dispatcher.js";
import {
  FakeYouTubeClient,
  YouTubeProvider,
  ytScriptClient,
} from "../src/publishing/youtube.js";

// The base thumbnail exists on this PC unless a test says otherwise.
const yes = async () => true;
const claim = (over: Partial<Claim> = {}): Claim => ({
  destination_id: "d1",
  schedule_id: "s1",
  claim_token: "t1",
  attempt_id: "a1",
  platform: "youtube",
  provider: "native",
  external_id: "vid-1",
  render_path: "E:/ws/renders/master.mp4",
  draft: {
    title: "Mille volti",
    description: "Testo",
    tags: ["pop"],
    thumbnail_text: "Nuovo singolo",
  },
  ...over,
});

// Scripted database answers; records every step the worker takes.
function fakeDb(script: {
  checks?: Claim[];
  claims?: Claim[];
  intent?: boolean;
  handoff?: boolean;
}) {
  const steps: string[] = [];
  const finished: Array<{
    outcome: Outcome;
    url: string | null;
    error: string | null;
  }> = [];
  const db: DispatchDb = {
    recover: async () => {
      steps.push("recover");
      return script.checks ?? [];
    },
    claim: async () => {
      steps.push("claim");
      return script.claims ?? [];
    },
    intent: async () => {
      steps.push("intent");
      return script.intent ?? true;
    },
    handoff: async () => {
      steps.push("handoff");
      return script.handoff ?? true;
    },
    hold: async (_d, _t, reason) => {
      steps.push(`hold:${reason}`);
      return true;
    },
    finish: async (_d, _t, outcome, url, error) => {
      steps.push(`finish:${outcome}`);
      finished.push({ outcome, url, error });
    },
  };
  return { db, steps, finished };
}
function setup(script: Parameters<typeof fakeDb>[0]) {
  const youtube = new FakeYouTubeClient();
  const providers = new Map([["native:youtube", new YouTubeProvider(youtube)]]);
  return { ...fakeDb(script), youtube, providers };
}

describe("publish dispatcher", () => {
  it("claims, records the intent, hands off, flips public once and records the link", async () => {
    const run = setup({ claims: [claim()] });
    const result = await dispatchTick({
      db: run.db,
      providers: run.providers,
      workerId: "w",
      exists: yes,
    });
    expect(result).toMatchObject({ published: 1, skipped: 0 });
    expect(run.steps).toEqual([
      "recover",
      "claim",
      "intent",
      "handoff",
      "finish:published",
    ]);
    expect(run.youtube.calls).toEqual([
      { op: "update", videoId: "vid-1" },
      { op: "setPublic", videoId: "vid-1" },
    ]);
    expect(run.youtube.meta.get("vid-1")).toEqual({
      title: "Mille volti",
      description: "Testo",
      tags: ["pop"],
      thumbnailText: "Nuovo singolo",
      thumbnail: expect.stringMatching(/thumbnail\.png$/u),
    });
    expect(run.finished[0]?.url).toBe("https://youtu.be/vid-1");
  });

  it("holds before the intent when the approved thumbnail text has no base image", async () => {
    const run = setup({
      claims: [claim({ render_path: "E:/ws/renders/master.mp4" })],
    });
    const seen: string[] = [];
    await dispatchTick({
      db: run.db,
      providers: run.providers,
      workerId: "w",
      exists: async (path) => {
        seen.push(path.replace(/\\/gu, "/"));
        return false;
      },
    });
    expect(run.steps).toEqual(["recover", "claim", "hold:thumbnail_missing"]);
    expect(seen).toEqual(["E:/ws/renders/thumbnail.png"]);
    expect(run.youtube.calls).toEqual([]);
    // Without thumbnail text no base image is needed.
    const plain = setup({
      claims: [
        claim({
          draft: {
            title: "T",
            description: "",
            tags: [],
            thumbnail_text: "",
          },
        }),
      ],
    });
    await dispatchTick({
      db: plain.db,
      providers: plain.providers,
      workerId: "w",
      exists: async () => false,
    });
    expect(plain.steps).toContain("finish:published");
  });

  it("a refused metadata update keeps the video private and stores the code", async () => {
    const run = setup({
      claims: [claim({ render_path: "E:/ws/renders/master.mp4" })],
    });
    run.youtube.failNext = "update";
    await dispatchTick({
      db: run.db,
      providers: run.providers,
      workerId: "w",
      exists: yes,
    });
    expect(run.youtube.calls.map((call) => call.op)).toEqual([
      "update",
      "state",
    ]);
    expect(await run.youtube.state("vid-1")).toMatchObject({
      privacy: "private",
    });
    expect(run.finished[0]).toMatchObject({
      outcome: "definitely_not_accepted",
      error: "metadata_update_failed",
    });
    // The next attempt pushes the base thumbnail path found next to the render.
    const again = setup({
      claims: [claim({ render_path: "E:/ws/renders/master.mp4" })],
    });
    await dispatchTick({
      db: again.db,
      providers: again.providers,
      workerId: "w",
      exists: yes,
    });
    expect(
      again.youtube.meta.get("vid-1")?.thumbnail?.replace(/\\/gu, "/"),
    ).toBe("E:/ws/renders/thumbnail.png");
  });

  it("sends nothing when the veto won the handoff or the intent", async () => {
    for (const script of [{ handoff: false }, { intent: false }]) {
      const run = setup({ claims: [claim()], ...script });
      await dispatchTick({
        db: run.db,
        providers: run.providers,
        workerId: "w",
        exists: yes,
      });
      expect(run.youtube.calls).toEqual([]);
      expect(run.steps.some((step) => step.startsWith("finish"))).toBe(false);
    }
  });

  it("an unhealthy worker claims nothing; a draft over the limits gets no intent", async () => {
    const sick = setup({ claims: [claim()] });
    await dispatchTick({
      db: sick.db,
      providers: sick.providers,
      workerId: "w",
      exists: yes,
      healthy: () => false,
    });
    expect(sick.steps).toEqual(["recover"]);
    const long = setup({
      claims: [
        claim({
          draft: {
            title: "x".repeat(101),
            description: "",
            tags: [],
            thumbnail_text: "",
          },
        }),
      ],
    });
    await dispatchTick({
      db: long.db,
      providers: long.providers,
      workerId: "w",
      exists: yes,
    });
    expect(long.steps).toEqual(["recover", "claim"]);
    expect(long.youtube.calls).toEqual([]);
  });

  it.each([
    ["refuse", "definitely_not_accepted"],
    ["lost", "published"],
    ["dark", "unknown"],
  ] as const)(
    "a failed flip (%s) is settled by the status only: %s",
    async (fail, outcome) => {
      const run = setup({ claims: [claim()] });
      run.youtube.failNext = fail;
      await dispatchTick({
        db: run.db,
        providers: run.providers,
        workerId: "w",
        exists: yes,
      });
      expect(run.steps.at(-1)).toBe(`finish:${outcome}`);
      // One flip, one status read: never a blind second flip.
      expect(run.youtube.calls.map((call) => call.op)).toEqual([
        "update",
        "setPublic",
        "state",
      ]);
    },
  );

  it("stores a short error code, never the provider's raw text", async () => {
    const run = setup({ claims: [claim()] });
    run.youtube.failNext = "dark";
    await dispatchTick({
      db: run.db,
      providers: run.providers,
      workerId: "w",
      exists: yes,
    });
    expect(run.finished[0]).toMatchObject({
      outcome: "unknown",
      error: "set_public_failed",
    });
    const raw = fakeDb({ claims: [claim()] });
    const provider = new YouTubeProvider(new FakeYouTubeClient());
    provider.postNow = async () => {
      throw new Error("Traceback: HttpError 500 at E:/engine/publish/yt.py");
    };
    await dispatchTick({
      db: raw.db,
      providers: new Map([["native:youtube", provider]]),
      workerId: "w",
      exists: yes,
    });
    expect(raw.finished[0]?.error).toBe("provider_error");
    const lost = fakeDb({ checks: [claim()] });
    await dispatchTick({
      db: lost.db,
      providers: new Map([
        ["native:youtube", new YouTubeProvider(new FakeYouTubeClient())],
      ]),
      workerId: "w",
      exists: yes,
    });
    expect(lost.finished[0]?.error).toBe(
      "lost_handoff_definitely_not_accepted",
    );
  });

  it("a lost handoff found by recovery is settled by the status, never flipped again", async () => {
    const youtube = new FakeYouTubeClient();
    youtube.videos.set("vid-1", "public");
    const run = fakeDb({ checks: [claim()] });
    await dispatchTick({
      db: run.db,
      providers: new Map([["native:youtube", new YouTubeProvider(youtube)]]),
      workerId: "w",
      exists: yes,
    });
    expect(run.steps).toEqual(["recover", "finish:published", "claim"]);
    expect(youtube.calls).toEqual([{ op: "state", videoId: "vid-1" }]);
    const unknown = fakeDb({ checks: [claim({ provider: "blotato" })] });
    await dispatchTick({
      db: unknown.db,
      providers: new Map(),
      workerId: "w",
      exists: yes,
    });
    expect(unknown.finished[0]?.outcome).toBe("unknown");
  });

  it("a video YouTube itself scheduled (old flow publishAt) is held for the owner, never retried", async () => {
    const youtube = new FakeYouTubeClient();
    youtube.publishAt.set("vid-1", "2026-12-01T10:00:00Z");
    const run = fakeDb({ checks: [claim()] });
    await dispatchTick({
      db: run.db,
      providers: new Map([["native:youtube", new YouTubeProvider(youtube)]]),
      workerId: "w",
      exists: yes,
    });
    expect(run.finished[0]?.outcome).toBe("unknown");
    expect(youtube.calls.map((call) => call.op)).toEqual(["state"]);
  });
});

describe("publishing wired in main", () => {
  afterEach(() => vi.useRealTimers());
  it("claims only while the worker loop's health check passes", async () => {
    vi.useFakeTimers();
    const db = new InMemoryDb([], []);
    const loop = new WorkerLoop({ db, workerId: "w", stages: {} });
    const run = fakeDb({ claims: [] });
    const stop = startPublishing({
      db: run.db,
      youtube: new FakeYouTubeClient(),
      workerId: "w",
      loop,
      report: () => {},
      intervalMs: 1000,
    });
    // Never checked in: unhealthy, nothing is claimed.
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.steps).not.toContain("claim");
    const running = loop.runForever();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loop.healthy()).toBe(true);
    expect(run.steps).toContain("claim");
    // The database check-in fails for longer than the window: unhealthy again.
    vi.spyOn(db, "upsertWorker").mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(loop.healthy()).toBe(false);
    run.steps.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.steps).toEqual(["recover"]);
    stop();
    await loop.stop();
    await running;
  });
});

describe("YouTube through yt.py", () => {
  it("pushes the approved metadata through yt.py update --confirm with a file it removes", async () => {
    const tmp = await mkdtemp(join(process.env.TEMP ?? ".", "yt-update-"));
    try {
      const seen: { args: string[]; body: unknown }[] = [];
      const client = ytScriptClient(async (args) => {
        seen.push({
          args,
          body: JSON.parse(await readFile(args[2] as string, "utf8")),
        });
        return "vid-1 metadata updated\n";
      }, tmp);
      await client.update("vid-1", {
        title: "Nuovo",
        description: "D",
        tags: ["a"],
        thumbnailText: "Ciao",
        thumbnail: "E:/ws/thumbnail.png",
      });
      expect(seen[0]?.args.slice(0, 2)).toEqual(["update", "vid-1"]);
      expect(seen[0]?.args.at(-1)).toBe("--confirm");
      expect(seen[0]?.body).toEqual({
        title: "Nuovo",
        description: "D",
        tags: ["a"],
        thumbnail_text: "Ciao",
        thumbnail: "E:/ws/thumbnail.png",
      });
      expect(await readdir(tmp)).toEqual([]);
      const refused = ytScriptClient(async () => {
        throw new Error("yt: refused");
      }, tmp);
      await expect(
        refused.update("vid-1", {
          title: "T",
          description: "",
          tags: [],
          thumbnailText: "",
          thumbnail: null,
        }),
      ).rejects.toThrow(/refused/);
      expect(await readdir(tmp)).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("flips with privacy public --confirm and never a publish time; reads the status JSON", async () => {
    const calls: string[][] = [];
    const client = ytScriptClient(async (args) => {
      calls.push(args);
      return args[0] === "status"
        ? 'loading token\n{\n "title": "T",\n "status": {"privacyStatus": "private"}\n}\n'
        : "vid-1 -> public\n";
    });
    await client.setPublic("vid-1");
    expect(await client.state("vid-1")).toEqual({
      privacy: "private",
      publishAt: null,
    });
    expect(calls).toEqual([
      ["privacy", "vid-1", "public", "--confirm"],
      ["status", "vid-1"],
    ]);
    expect(calls.flat()).not.toContain("--publish-at");
    const broken = ytScriptClient(async () => "no json here");
    expect(await broken.state("vid-1")).toBeNull();
    const old = ytScriptClient(
      async () =>
        '{"status": {"privacyStatus": "private", "publishAt": "2026-12-01T10:00:00Z"}}',
    );
    expect(await old.state("vid-1")).toEqual({
      privacy: "private",
      publishAt: "2026-12-01T10:00:00Z",
    });
  });

  it("maps the privacy to the provider status; only a private video allows a new attempt", async () => {
    const youtube = new FakeYouTubeClient();
    const provider = new YouTubeProvider(youtube);
    expect(await provider.status("a", "v")).toBe("definitely_not_accepted");
    youtube.videos.set("v", "public");
    expect(await provider.status("a", "v")).toBe("published");
    youtube.videos.set("v", "unlisted");
    expect(await provider.status("a", "v")).toBe("unknown");
    // The old flow's YouTube publishAt: scheduled by YouTube, never a new attempt.
    youtube.videos.set("v", "private");
    youtube.publishAt.set("v", "2026-12-01T10:00:00Z");
    expect(await provider.status("a", "v")).toBe("scheduled");
    youtube.publishAt.delete("v");
    youtube.videos.set("v", null);
    expect(await provider.status("a", "v")).toBe("unknown");
    expect(await provider.status("a")).toBe("unknown");
    await expect(
      provider.stageMedia({
        platform: "youtube",
        accountId: "default",
        renderId: "r",
        format: "landscape",
        caption: "",
        hashtags: [],
        aiGenerated: true,
        madeForKids: false,
        platformExtras: {},
      }),
    ).rejects.toThrow(/private upload pending/);
  });
});
