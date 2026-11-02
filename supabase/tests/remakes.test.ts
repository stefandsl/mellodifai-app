import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remakeLyricsText } from "../../packages/shared/src/remake/workflow";

// "Rifai da YouTube" and the AI lyric buttons (migration 20261102000025): remake_start and the
// review RPCs (edit, regenerate a section, accept, cancel, dismiss, retry), the originality gate
// on accept, the revision conflict, my_remake, and the songless lyrics_assist jobs.
//
// A worker may be running against this database: every job made here is parked (not_before in a
// day) right after the assertions that need it queued.
let service: SupabaseClient;
let client: SupabaseClient;
let other: SupabaseClient;
let owner: string;
const users: string[] = [];
const prefix = `rmk-${Date.now()}`;
const URL_ = "https://www.youtube.com/watch?v=49rDdMbXd_w";
function env(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`${k} required`);
  return v;
}

beforeAll(async () => {
  service = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  for (const suffix of ["a", "b"]) {
    const email = `${prefix}-${suffix}@example.test`;
    await service.from("admin_allowlist").insert({ email });
    const result = await service.auth.admin.createUser({
      email,
      password: "rmk-test-password",
      email_confirm: true,
    });
    expect(result.error).toBeNull();
    const id = result.data.user?.id;
    if (!id) throw new Error("user missing");
    users.push(id);
    const c = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
    });
    expect(
      (
        await c.auth.signInWithPassword({
          email,
          password: "rmk-test-password",
        })
      ).error,
    ).toBeNull();
    if (suffix === "a") {
      client = c;
      owner = id;
    } else other = c;
  }
});

afterAll(async () => {
  if (!service) return;
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});

async function park(versionId: string | null, requestId?: string) {
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const query = service
    .from("jobs")
    .update({ not_before: later })
    .eq("status", "queued");
  const { error } = versionId
    ? await query.eq("version_id", versionId)
    : await query.eq("payload->>request_id", requestId ?? "");
  expect(error).toBeNull();
}

function line(index: number, text: string, flagged = false) {
  return {
    index,
    source: `source line ${index}`,
    text,
    start: index * 3,
    end: index * 3 + 3,
    target: { min: 7, max: 7, ending: "stressed" },
    syllables: { min: 7, max: 7 },
    ending: "stressed",
    fits: true,
    originality: {
      jaccard4: 0.1,
      rougeL: 0.1,
      semantic: 0.3,
      closestSource: index,
      against: "translation",
      flagged,
      reasons: flagged ? ["too close"] : [],
    },
  };
}

function lyricsFixture(flaggedLine = false) {
  return {
    schemaVersion: 1,
    lang: "it",
    country: null,
    title: "Voce nel vento",
    styleTags: ["rock", "79 bpm"],
    sections: [
      { id: "intro-1", kind: "intro", label: "Intro", lines: [] },
      {
        id: "verse-1",
        kind: "verse",
        label: "Verse 1",
        lines: [
          line(0, "cammino dove il vento tace"),
          line(1, "  conto i passi sulla strada "),
        ],
      },
      {
        id: "chorus-1",
        kind: "chorus",
        label: "Chorus 1",
        lines: [line(2, "nessuno sente la mia voce", flaggedLine)],
      },
    ],
    lyricsText: "",
    literalTranslation: ["a", "b", "c"],
    originality: {
      thresholds: {
        lexical: 0.35,
        semantic: 0.8,
        phraseWords: 3,
        sectionMeaningRatio: 0.85,
        sectionMeaningFloor: 0.3,
      },
      embedder: "fake",
      flaggedLines: flaggedLine ? 1 : 0,
      maxLexical: 0.1,
      maxSemantic: 0.3,
      phrase: { ok: true, longestRun: 1, detail: "" },
      meaningGate: "enforce",
      sections: [],
    },
    jury: { passed: true, rounds: [], stoppedBecause: "passed" },
    cost: { usd: 0.03, calls: [] },
  };
}

async function start() {
  const { data, error } = await client.rpc("remake_start", {
    p_url: URL_,
    p_video_id: "49rDdMbXd_w",
    p_lang: "it",
    p_country: "IT",
  });
  expect(error).toBeNull();
  const { data: remake } = await service
    .from("remakes")
    .select("*")
    .eq("id", data as string)
    .single();
  return remake as {
    id: string;
    version_id: string;
    project_id: string;
    revision: number;
  };
}

// What the worker does after R3: the lyrics are stored and the review begins.
async function toReview(id: string, lyrics = lyricsFixture()) {
  const { error } = await service
    .from("remakes")
    .update({ stage: "review", lyrics, revision: 1 })
    .eq("id", id);
  expect(error).toBeNull();
}

function pack(lyrics: ReturnType<typeof lyricsFixture>) {
  return {
    title: "Voce nel vento",
    lyrics: remakeLyricsText(lyrics as never),
    style: "rock, 79 bpm, d minor",
    exclude: "",
    settings: {
      model: "V6",
      styleWeight: 0.7,
      weirdness: 0.35,
      variety: 1,
      duration: null,
    },
    displayMap: {},
    l10n: {},
  };
}

describe("remake_start", () => {
  it("validates the link, the language and the country", async () => {
    for (const args of [
      {
        p_url: "https://example.com/watch?v=49rDdMbXd_w",
        p_video_id: "49rDdMbXd_w",
        p_lang: "it",
      },
      { p_url: URL_, p_video_id: "short", p_lang: "it" },
      { p_url: URL_, p_video_id: "aaaaaaaaaaa", p_lang: "it" },
      { p_url: URL_, p_video_id: "49rDdMbXd_w", p_lang: "xx" },
      {
        p_url: URL_,
        p_video_id: "49rDdMbXd_w",
        p_lang: "it",
        p_country: "Italy",
      },
    ])
      expect((await client.rpc("remake_start", args)).error).not.toBeNull();
  });

  it("creates the song in analysis, the remake and the R1 job; one remake at a time", async () => {
    const remake = await start();
    const { data: version } = await service
      .from("versions")
      .select("status,lang,project_id")
      .eq("id", remake.version_id)
      .single();
    expect(version).toMatchObject({ status: "analysing", lang: "it" });
    const { data: project } = await service
      .from("projects")
      .select("source,topic")
      .eq("id", remake.project_id)
      .single();
    expect(project?.source).toMatchObject({
      kind: "remake",
      licence: "unknown",
    });
    const { data: jobs } = await service
      .from("jobs")
      .select("stage,status")
      .eq("version_id", remake.version_id);
    expect(jobs).toEqual([{ stage: "remake_ingest", status: "queued" }]);
    await park(remake.version_id);
    const again = await client.rpc("remake_start", {
      p_url: URL_,
      p_video_id: "49rDdMbXd_w",
      p_lang: "en",
    });
    expect(again.error?.message).toMatch(/already running/u);
    // The owner reads it; nobody else does.
    expect(
      (await client.from("remakes").select("id").eq("id", remake.id)).data,
    ).toHaveLength(1);
    expect(
      (await other.from("remakes").select("id").eq("id", remake.id)).data,
    ).toHaveLength(0);
    expect(
      (await other.rpc("remake_cancel", { p_remake: remake.id })).error,
    ).not.toBeNull();
    // my_remake reports the active job with its queue position.
    const { data: mine } = await client.rpc("my_remake");
    expect(mine).toMatchObject({
      remake: { id: remake.id, stage: "ingest" },
      job: { stage: "remake_ingest", status: "queued" },
    });
    expect(
      (await client.rpc("remake_cancel", { p_remake: remake.id })).error,
    ).toBeNull();
    const { data: cancelled } = await service
      .from("jobs")
      .select("status")
      .eq("version_id", remake.version_id);
    expect(cancelled).toEqual([{ status: "cancelled" }]);
    const { data: trashed } = await service
      .from("versions")
      .select("trashed_at")
      .eq("id", remake.version_id)
      .single();
    expect(trashed?.trashed_at).not.toBeNull();
    expect((await client.rpc("my_remake")).data).toBeNull();
  });
});

describe("the review", () => {
  it("checks edits, refuses stale revisions and keeps the originality gate on accept", async () => {
    const remake = await start();
    await park(remake.version_id);
    await service
      .from("jobs")
      .update({ status: "done" })
      .eq("version_id", remake.version_id);
    await toReview(remake.id, lyricsFixture(true));

    const stale = await client.rpc("remake_edit", {
      p_remake: remake.id,
      p_revision: 0,
      p_lines: [{ index: 2, text: "nessuno ascolta il mio canto" }],
    });
    expect(stale.error?.message).toMatch(/conflict/u);
    for (const bad of [
      [{ index: 99, text: "x" }],
      [{ index: 2, text: "two\nlines" }],
      [{ index: 2, text: "  " }],
    ])
      expect(
        (
          await client.rpc("remake_edit", {
            p_remake: remake.id,
            p_revision: 1,
            p_lines: bad,
          })
        ).error,
      ).not.toBeNull();
    const edited = await client.rpc("remake_edit", {
      p_remake: remake.id,
      p_revision: 1,
      p_lines: [{ index: 2, text: " nessuno ascolta il mio canto " }],
      p_title: "Canto nel vento",
    });
    expect(edited.error).toBeNull();
    expect(edited.data).toBe(2);
    const { data: row } = await service
      .from("remakes")
      .select("pending,revision")
      .eq("id", remake.id)
      .single();
    expect(row).toEqual({
      pending: {
        lines: [{ index: 2, text: "nessuno ascolta il mio canto" }],
        title: "Canto nel vento",
      },
      revision: 2,
    });
    const { data: check } = await service
      .from("jobs")
      .select("stage,payload,status")
      .eq("version_id", remake.version_id)
      .eq("status", "queued");
    expect(check).toEqual([
      {
        stage: "remake_rewrite",
        payload: { mode: "check", revision: 2 },
        status: "queued",
      },
    ]);
    await park(remake.version_id);
    // Nothing is accepted while the check of an edit is pending.
    const early = await client.rpc("remake_accept", {
      p_remake: remake.id,
      p_revision: 2,
      p_pack: pack(lyricsFixture()),
      p_settings: { engine: "kie", model: "V6" },
    });
    expect(early.error?.message).toMatch(/wait for the running step/u);

    // The worker ran the check: the line is still flagged.
    await service
      .from("jobs")
      .update({ status: "done" })
      .eq("version_id", remake.version_id);
    await service
      .from("remakes")
      .update({ pending: null, lyrics: lyricsFixture(true), revision: 3 })
      .eq("id", remake.id);
    const flagged = await client.rpc("remake_accept", {
      p_remake: remake.id,
      p_revision: 3,
      p_pack: pack(lyricsFixture(true)),
      p_settings: { engine: "kie", model: "V6" },
    });
    expect(flagged.error?.message).toMatch(/originality gate not passed/u);

    const ok = lyricsFixture();
    await service
      .from("remakes")
      .update({ lyrics: ok, revision: 4 })
      .eq("id", remake.id);
    const other_ = { ...pack(ok), lyrics: "[Verse]\nsomething else" };
    expect(
      (
        await client.rpc("remake_accept", {
          p_remake: remake.id,
          p_revision: 4,
          p_pack: other_,
          p_settings: { engine: "kie", model: "V6" },
        })
      ).error?.message,
    ).toMatch(/differ from the reviewed/u);
    expect(
      (
        await client.rpc("remake_accept", {
          p_remake: remake.id,
          p_revision: 4,
          p_pack: pack(ok),
          p_settings: { engine: "kie", source: { mode: "cover" } },
        })
      ).error,
    ).not.toBeNull();
    const accepted = await client.rpc("remake_accept", {
      p_remake: remake.id,
      p_revision: 4,
      p_pack: pack(ok),
      p_settings: { engine: "kie", model: "V6", video: "lyric" },
      p_vocal_gender: "f",
    });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toBe(remake.version_id);
    const { data: version } = await service
      .from("versions")
      .select("status,lyric_pack")
      .eq("id", remake.version_id)
      .single();
    expect(version?.status).toBe("song_queued");
    expect(version?.lyric_pack?.lyrics).toBe(
      "[Intro]\n\n[Verse 1]\ncammino dove il vento tace\nconto i passi sulla strada\n\n[Chorus 1]\nnessuno sente la mia voce",
    );
    const { data: jobs } = await service
      .from("jobs")
      .select("stage")
      .eq("version_id", remake.version_id)
      .eq("status", "queued");
    expect(jobs).toEqual([{ stage: "generate_song" }]);
    await park(remake.version_id);
    const { data: project } = await service
      .from("projects")
      .select("topic,style,vocal_gender,song_settings")
      .eq("id", remake.project_id)
      .single();
    expect(project).toMatchObject({
      topic: "Voce nel vento",
      style: "rock, 79 bpm, d minor",
      vocal_gender: "f",
      song_settings: { engine: "kie", video: "lyric" },
    });
    const { data: done } = await service
      .from("remakes")
      .select("stage")
      .eq("id", remake.id)
      .single();
    expect(done?.stage).toBe("accepted");
    expect(
      (await client.rpc("remake_dismiss", { p_remake: remake.id })).error,
    ).toBeNull();
    // An accepted remake's song stays in the library.
    const { data: kept } = await service
      .from("versions")
      .select("trashed_at")
      .eq("id", remake.version_id)
      .single();
    expect(kept?.trashed_at).toBeNull();
  });

  it("regenerates one known section at a time", async () => {
    const remake = await start();
    await park(remake.version_id);
    await service
      .from("jobs")
      .update({ status: "done" })
      .eq("version_id", remake.version_id);
    await toReview(remake.id);
    for (const section of ["intro-1", "nope"])
      expect(
        (
          await client.rpc("remake_regenerate_section", {
            p_remake: remake.id,
            p_revision: 1,
            p_section: section,
          })
        ).error?.message,
      ).toMatch(/unknown section/u);
    expect(
      (
        await client.rpc("remake_regenerate_section", {
          p_remake: remake.id,
          p_revision: 1,
          p_section: "chorus-1",
        })
      ).error,
    ).toBeNull();
    const { data: jobs } = await service
      .from("jobs")
      .select("payload")
      .eq("version_id", remake.version_id)
      .eq("status", "queued");
    expect(jobs).toEqual([
      { payload: { mode: "section", section: "chorus-1", revision: 1 } },
    ]);
    expect(
      (
        await client.rpc("remake_regenerate_section", {
          p_remake: remake.id,
          p_revision: 1,
          p_section: "verse-1",
        })
      ).error?.message,
    ).toMatch(/wait for the running step/u);
    await park(remake.version_id);
    await client.rpc("remake_cancel", { p_remake: remake.id });
  });

  it("retries a failed stage and lets the person throw a failed remake away", async () => {
    const remake = await start();
    await park(remake.version_id);
    await service
      .from("jobs")
      .update({
        status: "failed",
        error: "Private video",
        finished_at: new Date().toISOString(),
      })
      .eq("version_id", remake.version_id);
    await service
      .from("versions")
      .update({ status: "failed" })
      .eq("id", remake.version_id);
    await service
      .from("remakes")
      .update({
        stage: "failed",
        error_code: "private",
        error: "Private video",
      })
      .eq("id", remake.id);
    const { data: mine } = await client.rpc("my_remake");
    expect(mine).toMatchObject({
      remake: { stage: "failed", error_code: "private" },
      job: null,
      failedJob: { stage: "remake_ingest" },
    });
    expect(
      (await client.rpc("remake_retry", { p_remake: remake.id })).error,
    ).toBeNull();
    const { data: after } = await service
      .from("remakes")
      .select("stage,error_code")
      .eq("id", remake.id)
      .single();
    expect(after).toEqual({ stage: "ingest", error_code: null });
    const { data: version } = await service
      .from("versions")
      .select("status")
      .eq("id", remake.version_id)
      .single();
    expect(version?.status).toBe("analysing");
    await park(remake.version_id);
    // Failed again: dismissing trashes the unfinished song.
    await service
      .from("jobs")
      .update({ status: "failed" })
      .eq("version_id", remake.version_id)
      .eq("status", "queued");
    await service
      .from("remakes")
      .update({ stage: "failed" })
      .eq("id", remake.id);
    expect(
      (await client.rpc("remake_dismiss", { p_remake: remake.id })).error,
    ).toBeNull();
    const { data: gone } = await service
      .from("versions")
      .select("trashed_at")
      .eq("id", remake.version_id)
      .single();
    expect(gone?.trashed_at).not.toBeNull();
  });

  it("composes the same lyrics text as the studio", async () => {
    const lyrics = lyricsFixture();
    const { data, error } = await service.rpc("remake_lyrics_text", {
      p_lyrics: lyrics,
    });
    expect(error).toBeNull();
    expect(data).toBe(remakeLyricsText(lyrics as never));
  });
});

describe("lyrics_assist", () => {
  it("queues one songless job per person and reports its state", async () => {
    for (const [mode, input] of [
      ["write", {}],
      ["improve", { lyrics: " " }],
      ["sing", { lyrics: "x" }],
    ] as const)
      expect(
        (
          await client.rpc("lyrics_assist_request", {
            p_mode: mode,
            p_lang: "it",
            p_input: input,
          })
        ).error,
      ).not.toBeNull();
    const { data: id, error } = await client.rpc("lyrics_assist_request", {
      p_mode: "write",
      p_lang: "it",
      p_input: { brief: "una gita al lago", title: "", style: "folk" },
    });
    expect(error).toBeNull();
    const { data: job } = await service
      .from("jobs")
      .select("version_id,stage,status,payload")
      .eq("payload->>request_id", id as string)
      .single();
    expect(job).toEqual({
      version_id: null,
      stage: "lyrics_assist",
      status: "queued",
      payload: { request_id: id },
    });
    const busy = await client.rpc("lyrics_assist_request", {
      p_mode: "improve",
      p_lang: "it",
      p_input: { lyrics: "[Verse]\nciao" },
    });
    expect(busy.error?.message).toMatch(/already running/u);
    const { data: state } = await client.rpc("lyrics_assist_state", {
      p_request: id,
    });
    expect(state).toMatchObject({
      id,
      mode: "write",
      status: "queued",
      result: null,
    });
    expect(state.queuePosition).toBeGreaterThanOrEqual(1);
    expect(
      (await other.rpc("lyrics_assist_state", { p_request: id })).data,
    ).toBeNull();
    expect(
      (await other.rpc("lyrics_assist_cancel", { p_request: id })).error,
    ).not.toBeNull();
    expect(
      (await client.rpc("lyrics_assist_cancel", { p_request: id })).error,
    ).toBeNull();
    const { data: cancelled } = await client.rpc("lyrics_assist_state", {
      p_request: id,
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("allows a job without a song only for lyrics_assist", async () => {
    const { error } = await service.from("jobs").insert({
      owner_id: owner,
      version_id: null,
      stage: "draft_lyrics",
      idempotency_key: `${prefix}-songless`,
    });
    expect(error?.message).toMatch(/jobs_songless_stage/u);
  });
});
