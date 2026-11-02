import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { RedactionError, RemakeError, runtimeRoot } from "@mellodifai/remake";
import { RemakeLyricsSchema } from "@mellodifai/shared";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDb, type Job, type Remake } from "../src/db.js";
import { Engine } from "../src/engine.js";
import { fakeRemakeEngine } from "../src/fake/remake.js";
import { WorkerLoop } from "../src/loop.js";
import { lyricsAssist } from "../src/stages/lyrics-assist.js";
import { type RemakeEngine, remakeStages } from "../src/stages/remake.js";

// Task 27: R1 to R3 as jobs of the remake's version (fake engine, real stage code and gates) and
// the songless lyrics_assist job of the create panel.

const LYRICS_FIXTURE = new URL(
  "../../../packages/remake/test/fixtures/remake-lyrics.it.json",
  import.meta.url,
);
const fixtureLyrics = () =>
  RemakeLyricsSchema.parse(JSON.parse(readFileSync(LYRICS_FIXTURE, "utf8")));

const owner = "owner-1";
const project = {
  id: "project-1",
  owner_id: owner,
  topic: "YouTube 49rDdMbXd_w",
  theme: "general",
  source: { kind: "remake", licence: "unknown" },
};
const version = {
  owner_id: owner,
  id: "version-1",
  project_id: project.id,
  lang: "it" as const,
  status: "analysing" as const,
};
function remakeRow(patch: Partial<Remake> = {}): Remake {
  return {
    id: "remake-1",
    owner_id: owner,
    project_id: project.id,
    version_id: version.id,
    url: "https://www.youtube.com/watch?v=49rDdMbXd_w",
    video_id: "49rDdMbXd_w",
    lang: "it",
    country: "IT",
    stage: "ingest",
    error_code: null,
    error: null,
    source: null,
    analysis: null,
    lyrics: null,
    pending: null,
    revision: 0,
    cost: {},
    ...patch,
  };
}
const job = (stage: Job["stage"], payload: Record<string, unknown> = {}) => ({
  owner_id: owner,
  id: `job-${stage}-${Math.random()}`,
  version_id: version.id,
  stage,
  status: "queued" as const,
  idempotency_key: `${stage}:${Math.random()}`,
  payload,
});
const dependencies = {
  workspace: {
    forVersion: async () => ({
      root: "",
      versionsDir: "",
      outDir: "",
      publicDir: "",
      renderDir: "",
    }),
  },
  engine: new Engine({ log: async () => {} }),
  storage: { upload: async () => {} },
  secrets: {
    values: { OPENROUTER_API_KEY: "or-test-key-123" } as Record<string, string>,
    redact: (text: string) => text.replaceAll("or-test-key-123", "***"),
  },
};

const scratchDirs: string[] = [];
function scratch() {
  const root = join(runtimeRoot(), "tmp");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "remake-worker-"));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function loop(
  db: InMemoryDb,
  engine: RemakeEngine = fakeRemakeEngine(async () => {}),
) {
  return new WorkerLoop({
    db,
    workerId: "test",
    stages: remakeStages(engine, { root: scratch() }),
    songless: { lyrics_assist: lyricsAssist },
    ...dependencies,
  });
}

function setup(remake: Partial<Remake>, jobs: ReturnType<typeof job>[]) {
  const db = new InMemoryDb(jobs, [{ ...version }], [structuredClone(project)]);
  db.remakes.push(remakeRow(remake));
  return db;
}

describe("remake stages", () => {
  it("runs R1, R2 and R3 as chained jobs and stops at the review", async () => {
    const db = setup({}, [job("remake_ingest")]);
    const worker = loop(db);
    for (let i = 0; i < 3; i++) expect(await worker.runOnce()).toBe(true);
    expect(db.jobs.map((j) => [j.stage, j.status, j.payload ?? {}])).toEqual([
      ["remake_ingest", "done", {}],
      ["remake_analyse", "done", {}],
      ["remake_rewrite", "done", { mode: "full" }],
    ]);
    const remake = db.remakes[0];
    expect(remake).toMatchObject({
      stage: "review",
      revision: 1,
      error_code: null,
      source: { licence: "cc-by", lines: 36 },
    });
    expect(remake?.analysis).toMatchObject({
      bpm: 79,
      key: { tonic: "D", mode: "minor" },
      sourceLanguage: "en",
    });
    expect(remake?.lyrics).toMatchObject({
      title: "Mille volti",
      lang: "it",
      country: "IT",
    });
    expect(db.versions[0]?.status).toBe("analysing");
    expect(db.projects[0]).toMatchObject({
      topic: expect.stringContaining("Alone"),
      source: { kind: "remake", licence: "cc-by" },
    });
    // Progress events carry the step keys the create panel translates.
    expect(db.events.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        "ingest.audio",
        "analyse.stems",
        "rewrite.write",
        "rewrite.done",
      ]),
    );
  });

  it("fails a private video with a code the create panel can explain", async () => {
    const db = setup(
      {
        url: "https://www.youtube.com/watch?v=PrivateVid0",
        video_id: "PrivateVid0",
      },
      [job("remake_ingest")],
    );
    await loop(db).runOnce();
    expect(db.jobs[0]?.status).toBe("failed");
    expect(db.versions[0]?.status).toBe("failed");
    expect(db.remakes[0]).toMatchObject({
      stage: "failed",
      error_code: "private",
    });
  });

  it("turns the OpenRouter privacy filter into an actionable code, never into lyrics", async () => {
    const engine = fakeRemakeEngine(async () => {});
    engine.rewrite = async () => {
      throw new RedactionError("write", "resto [PERSON_NAME]");
    };
    const db = setup({ stage: "rewrite" }, [
      job("remake_rewrite", { mode: "full" }),
    ]);
    // The analysis comes from an earlier run of the same video.
    const worker = loop(db, engine);
    db.jobs.unshift(job("remake_analyse"));
    await worker.runOnce();
    await worker.runOnce();
    expect(db.remakes[0]).toMatchObject({
      stage: "failed",
      error_code: "privacy_filter",
      lyrics: null,
    });
    expect(db.remakes[0]?.error).toMatch(/turn the filter off/u);
  });

  it("keeps the remake in review when a section rewrite fails", async () => {
    const engine = fakeRemakeEngine(async () => {});
    engine.rewriteSection = async () => {
      throw new RemakeError("cost_cap", "over the cap");
    };
    const db = setup(
      { stage: "review", lyrics: fixtureLyrics(), revision: 3 },
      [
        job("remake_analyse"),
        job("remake_rewrite", {
          mode: "section",
          section: "chorus-1",
          revision: 3,
        }),
      ],
    );
    const worker = loop(db, engine);
    await worker.runOnce();
    db.remakes[0] = { ...(db.remakes[0] as Remake), stage: "review" };
    await worker.runOnce();
    expect(db.jobs[1]?.status).toBe("failed");
    expect(db.versions[0]?.status).toBe("analysing");
    expect(db.remakes[0]).toMatchObject({
      stage: "review",
      error_code: "cost_cap",
      revision: 3,
    });
  });

  it("writes one section again and adds a jury round", async () => {
    const db = setup(
      { stage: "review", lyrics: fixtureLyrics(), revision: 3 },
      [
        job("remake_analyse"),
        job("remake_rewrite", {
          mode: "section",
          section: "bridge-1",
          revision: 3,
        }),
      ],
    );
    const worker = loop(db);
    await worker.runOnce();
    db.remakes[0] = { ...(db.remakes[0] as Remake), stage: "review" };
    await worker.runOnce();
    const lyrics = RemakeLyricsSchema.parse(db.remakes[0]?.lyrics);
    expect(
      lyrics.sections.find((s) => s.id === "bridge-1")?.lines[0]?.text,
    ).toBe("Siamo in bilico sul buio");
    expect(lyrics.jury.rounds).toHaveLength(2);
    expect(db.remakes[0]?.revision).toBe(4);
    expect(db.remakes[0]?.cost.sectionsUsd).toBeGreaterThan(0);
  });

  it("checks the person's edits with the gates and clears them", async () => {
    const db = setup(
      {
        stage: "review",
        lyrics: fixtureLyrics(),
        revision: 2,
        pending: {
          lines: [{ index: 8, text: "il mondo corre e non mi vede" }],
          title: "Mille volti accesi",
        },
      },
      [
        job("remake_analyse"),
        job("remake_rewrite", { mode: "check", revision: 2 }),
      ],
    );
    const worker = loop(db);
    await worker.runOnce();
    db.remakes[0] = { ...(db.remakes[0] as Remake), stage: "review" };
    expect(fixtureLyrics().originality.flaggedLines).toBe(1);
    await worker.runOnce();
    const remake = db.remakes[0];
    expect(remake?.pending).toBeNull();
    expect(remake?.revision).toBe(3);
    const lyrics = RemakeLyricsSchema.parse(remake?.lyrics);
    const line = lyrics.sections
      .flatMap((s) => s.lines)
      .find((l) => l.index === 8);
    expect(line).toMatchObject({
      text: "il mondo corre e non mi vede",
      edited: true,
    });
    expect(line?.originality.flagged).toBe(false);
    expect(lyrics.originality).toMatchObject({
      flaggedLines: 0,
      phrase: { ok: true },
    });
    expect(lyrics.title).toBe("Mille volti accesi");
  });

  it("flags an edit that copies the source", async () => {
    const db = setup(
      {
        stage: "review",
        lyrics: fixtureLyrics(),
        revision: 2,
        pending: {
          lines: [{ index: 14, text: "Tocca il futuro sul mio schermo" }],
        },
      },
      [
        job("remake_analyse"),
        job("remake_rewrite", { mode: "check", revision: 2 }),
      ],
    );
    const worker = loop(db);
    await worker.runOnce();
    db.remakes[0] = { ...(db.remakes[0] as Remake), stage: "review" };
    await worker.runOnce();
    const lyrics = RemakeLyricsSchema.parse(db.remakes[0]?.lyrics);
    expect(
      lyrics.sections.flatMap((s) => s.lines).find((l) => l.index === 14)
        ?.originality.flagged,
    ).toBe(true);
  });

  it("does nothing for a cancelled remake", async () => {
    const engine = fakeRemakeEngine(async () => {});
    const ingest = vi.spyOn(engine, "ingest");
    const db = setup({ stage: "cancelled" }, [job("remake_ingest")]);
    await loop(db, engine).runOnce();
    expect(ingest).not.toHaveBeenCalled();
    expect(db.jobs).toHaveLength(1);
    expect(db.jobs[0]?.status).toBe("done");
  });
});

describe("lyrics_assist (songless job)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const request = (mode: string, input: Record<string, unknown>) => ({
    id: "11111111-2222-4333-8444-555555555555",
    owner_id: owner,
    mode,
    lang: "it" as const,
    input,
    result: null,
    error_code: null,
  });
  const songless = (payload: Record<string, unknown>) => ({
    owner_id: owner,
    id: "assist-job",
    version_id: null,
    stage: "lyrics_assist" as const,
    status: "queued" as const,
    idempotency_key: "lyrics_assist:1",
    payload,
  });
  const json = (value: unknown) => new Response(JSON.stringify(value));
  const scores = {
    topic: 0.9,
    language: 0.9,
    singable: 0.85,
    chorus: 0.8,
    original: 0.95,
  };
  function openRouter(writerText: string) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        calls.push({ url, body });
        if (url.endsWith("/alpha/decisions"))
          return (body.questions as Record<string, unknown>).tone
            ? json({
                answers: {
                  tone: { choice: "story" },
                  writer: { choice: "fast", confidence: 0.9 },
                },
              })
            : json({
                answers: {
                  ...Object.fromEntries(
                    Object.entries(scores).map(([k, v]) => [k, { noul: v }]),
                  ),
                  improver: { choice: "fast" },
                },
              });
        const system = String(
          (body.messages as { content: string }[] | undefined)?.[0]?.content ??
            "",
        );
        if (system.startsWith("ROLE: songwriter"))
          return json({ choices: [{ message: { content: writerText } }] });
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scores,
                  issues: [],
                  improver: "fast",
                }),
              },
            },
          ],
        });
      }),
    );
    return calls;
  }

  it("writes lyrics from a brief, runs the jury and stores the result", async () => {
    const calls = openRouter(
      JSON.stringify({
        title: "Il lago",
        lyrics:
          "[Verse 1]\nRemi nell'acqua ferma\n\n[Chorus]\nAl lago si respira",
      }),
    );
    const db = new InMemoryDb([
      songless({ request_id: request("write", {}).id }),
    ]);
    db.lyricRequests.push(
      request("write", { brief: "una gita al lago", style: "folk" }),
    );
    await loop(db).runOnce();
    expect(db.jobs[0]?.status).toBe("done");
    expect(db.lyricRequests[0]?.result).toMatchObject({
      title: "Il lago",
      lyrics:
        "[Verse 1]\nRemi nell'acqua ferma\n\n[Chorus]\nAl lago si respira",
      jury: { available: true, passed: true },
    });
    const writer = calls.find((c) =>
      String(
        (c.body.messages as { content: string }[] | undefined)?.[0]?.content,
      ).startsWith("ROLE: songwriter"),
    );
    expect(
      String(
        (writer?.body.messages as { content: string }[] | undefined)?.[1]
          ?.content,
      ),
    ).toContain("Brief: una gita al lago");
    expect(writer?.body.model).toBe("anthropic/claude-sonnet-5.5");
    // A songless job never touches a song.
    expect(db.versions).toHaveLength(0);
  });

  it("rewrites only the chosen section and keeps the rest verbatim", async () => {
    openRouter(
      JSON.stringify({
        title: null,
        lyrics: "[Chorus]\nnuova riga\naltra riga",
      }),
    );
    const lyrics =
      "[Verse 1]\nuno\ndue\n\n[Chorus]\ntre\nquattro\n\n[Outro]\ncinque";
    const start = lyrics.indexOf("[Chorus]");
    const end = lyrics.indexOf("[Outro]");
    const db = new InMemoryDb([
      songless({ request_id: request("regenerate", {}).id }),
    ]);
    db.lyricRequests.push(
      request("regenerate", { lyrics, section: { start, end } }),
    );
    await loop(db).runOnce();
    expect(
      (db.lyricRequests[0]?.result as { lyrics?: string } | undefined)?.lyrics,
    ).toBe(
      "[Verse 1]\nuno\ndue\n\n[Chorus]\nnuova riga\naltra riga\n\n[Outro]\ncinque",
    );
  });

  it("never hands back lyrics the privacy filter altered", async () => {
    openRouter(
      JSON.stringify({ title: "x", lyrics: "[Verse]\nresto [PERSON_NAME]" }),
    );
    const db = new InMemoryDb([
      songless({ request_id: request("improve", {}).id }),
    ]);
    db.lyricRequests.push(
      request("improve", { lyrics: "[Verse]\nresto a casa" }),
    );
    await loop(db).runOnce();
    expect(db.jobs[0]?.status).toBe("failed");
    expect(db.lyricRequests[0]).toMatchObject({
      result: null,
      error_code: "privacy_filter",
    });
  });

  it("refuses a songless job that names anything but its own request", async () => {
    const handler = vi.fn(async () => ({}));
    const db = new InMemoryDb([
      songless({ request_id: request("write", {}).id, version_id: "x" }),
    ]);
    db.lyricRequests.push({ ...request("write", { brief: "b" }) });
    await new WorkerLoop({
      db,
      workerId: "test",
      stages: {},
      songless: { lyrics_assist: handler },
      ...dependencies,
    }).runOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(db.jobs[0]?.status).toBe("failed");
    const stranger = new InMemoryDb([
      songless({ request_id: request("write", {}).id }),
    ]);
    stranger.lyricRequests.push({
      ...request("write", { brief: "b" }),
      owner_id: "someone",
    });
    await new WorkerLoop({
      db: stranger,
      workerId: "test",
      stages: {},
      songless: { lyrics_assist: handler },
      ...dependencies,
    }).runOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(stranger.jobs[0]?.error).toMatch(/Unauthorized/u);
  });
});
