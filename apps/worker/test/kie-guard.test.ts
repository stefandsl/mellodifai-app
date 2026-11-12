import { describe, expect, it, vi } from "vitest";
import { InMemoryDb } from "../src/db.js";
import { KIE_TEST_TEXT, kieAllowed } from "../src/kie/guard.js";
import type { StageContext } from "../src/loop.js";
import { stages } from "../src/stages/index.js";

// kie charges real credits: a song of a test account (an e-mail ending in ".test") or a project
// marked as a test never reaches it, unless ALLOW_TEST_KIE=1. A full-flow test on the live stack
// spent 12 credits on 2026-11-01 before this guard.
function context(
  email: string,
  settings: Record<string, unknown> = { engine: "kie" },
  values: Record<string, string> = {},
) {
  const db = new InMemoryDb();
  db.profiles.push({ id: "owner", role: "admin", email });
  const run = vi.fn(async () => ({ code: 0 }));
  const ctx = {
    job: {
      id: "job",
      owner_id: "owner",
      stage: "generate_song",
      version_id: "version",
      status: "running",
      idempotency_key: "k",
      payload: { edit_id: "0d6b6f0e-8d39-4b8e-9d55-0f0e6f8a1c2b" },
    },
    version: {
      id: "version",
      owner_id: "owner",
      project_id: "project",
      lang: "it",
      status: "song_queued",
      generation_count: 1,
    },
    project: {
      id: "project",
      owner_id: "owner",
      topic: "t",
      theme: "vbp",
      song_settings: settings,
    },
    db,
    engine: { run, withWorkspace: () => ({ run }) },
    secrets: { values, redact: (line: string) => line },
    log: vi.fn(async () => {}),
    progress: vi.fn(async () => {}),
    signal: new AbortController().signal,
    ws: {
      root: "x",
      outDir: "x",
      versionsDir: "x",
      publicDir: "x",
      renderDir: "x",
    },
    storage: { upload: vi.fn() },
  } as unknown as StageContext;
  return { ctx, db, run };
}

describe("kie test guard", () => {
  it("refuses test accounts and songs marked as tests", async () => {
    expect(await kieAllowed(context("e2e-admin@mellodifai.test").ctx)).toBe(
      false,
    );
    expect(await kieAllowed(context("Someone@Example.TEST").ctx)).toBe(false);
    expect(
      await kieAllowed(
        context("owner@example.com", { engine: "kie", test: true }).ctx,
      ),
    ).toBe(false);
    expect(await kieAllowed(context("owner@example.com").ctx)).toBe(true);
  });
  it("lets an explicit ALLOW_TEST_KIE=1 through", async () => {
    expect(
      await kieAllowed(
        context(
          "e2e-admin@mellodifai.test",
          { engine: "kie" },
          { ALLOW_TEST_KIE: "1" },
        ).ctx,
      ),
    ).toBe(true);
  });
  it("fails a kie generation of a test song before any kie command", async () => {
    const { ctx, run } = context("e2e-admin@mellodifai.test");
    await expect(stages.generate_song?.(ctx)).rejects.toThrow(KIE_TEST_TEXT);
    expect(run).not.toHaveBeenCalled();
  });
  it("fails a kie rewrite of a test song before any request", async () => {
    const { ctx, db } = context("e2e-admin@mellodifai.test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    db.sectionEdits.push({
      id: "0d6b6f0e-8d39-4b8e-9d55-0f0e6f8a1c2b",
      version_id: "version",
      take_id: "take",
      engine: "kie",
      start_s: 10,
      end_s: 20,
      duration_s: 100,
      section_lines: [],
      section_lyrics: "x",
      full_lyrics: "x",
      old_lyrics: "x",
      alternatives: [],
    });
    ctx.job.stage = "replace_section";
    ctx.version.status = "audio_ready";
    await expect(stages.replace_section?.(ctx)).rejects.toThrow(KIE_TEST_TEXT);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
