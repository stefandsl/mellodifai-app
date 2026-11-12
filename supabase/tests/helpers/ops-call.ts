import type { SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { assertTestStack } from "../../../ops/test-db-guard";
import type { OpsResult } from "../../../packages/shared/src/ops/errors";
import { withRealCaps } from "./caps";

export async function opsCall(
  session: { userId: string; sessionId: string },
  fn: string,
  args: unknown[],
  opts?: { realCaps?: boolean },
): Promise<OpsResult<unknown>> {
  const url = process.env.TEST_MDF_WEB_URL;
  assertTestStack({ ...process.env, TEST_DB_URL: url });
  if (!url) throw new Error("TEST_MDF_WEB_URL is required");
  if (!/^[a-z][a-z0-9_]*$/.test(fn))
    throw new Error("Invalid ops function name");
  const sql = postgres(url, { max: 1 });
  const values = [
    {
      actor_kind: "session",
      user_id: session.userId,
      session_id: session.sessionId,
      remote: false,
    },
    ...args,
  ];
  const query = `select ops.${fn}(${values.map((_, index) => `$${index + 1}`).join(",")}) as result`;
  try {
    const run = async (db: Sql | TransactionSql) => {
      const [row] = await db.unsafe(query, values as never[]);
      return row.result as OpsResult<unknown>;
    };
    return await (opts?.realCaps ? withRealCaps(sql, run) : run(sql));
  } finally {
    await sql.end();
  }
}

const wrappers: Record<string, [string, string[], string?]> = {
  my_remake: ["my_remake", []],
  lyrics_assist_state: ["lyrics_assist_state", ["p_request"]],
  remake_start: [
    "remake_start",
    ["p_url", "p_video_id", "p_lang", "p_country"],
    "id",
  ],
  remake_edit: [
    "remake_edit",
    ["p_remake", "p_revision", "p_lines", "p_title"],
    "revision",
  ],
  remake_regenerate_section: [
    "remake_regenerate_section",
    ["p_remake", "p_revision", "p_section"],
  ],
  remake_accept: [
    "remake_accept",
    ["p_remake", "p_revision", "p_pack", "p_settings", "p_vocal_gender"],
    "id",
  ],
  remake_cancel: ["remake_cancel", ["p_remake"]],
  remake_dismiss: ["remake_dismiss", ["p_remake"]],
  remake_retry: ["remake_retry", ["p_remake"]],
  lyrics_assist_request: [
    "lyrics_assist_request",
    ["p_mode", "p_lang", "p_input"],
    "id",
  ],
  lyrics_assist_cancel: ["lyrics_assist_cancel", ["p_request"]],
  set_reaction: ["reaction_set", ["p_version", "p_reaction"]],
  count_play: ["play_count", ["p_version"]],
  rename_version: ["song_rename", ["p_version", "p_title"]],
  trash_versions: ["songs_trash", ["p_versions"], "count"],
  restore_versions: ["songs_restore", ["p_versions"], "count"],
  generate_again: ["song_generate_again", ["p_version", "p_generation"]],
  create_playlist: ["playlist_create", ["p_name"], "playlist_id"],
  rename_playlist: ["playlist_rename", ["p_playlist", "p_name"]],
  delete_playlist: ["playlist_delete", ["p_playlist"]],
  add_to_playlist: ["playlist_add", ["p_playlist", "p_versions"], "count"],
  remove_from_playlist: [
    "playlist_remove",
    ["p_playlist", "p_versions"],
    "count",
  ],
  reorder_playlist: ["playlist_reorder", ["p_playlist", "p_versions"]],
  confirm_publication: [
    "admin_confirm_publication",
    ["p_publication", "p_privacy", "p_publish_at"],
    "job_id",
  ],
  render_again: ["video_rerender", ["p_version"]],
  request_lyric_alignment: [
    "lyric_alignment_request",
    ["p_version", "p_take"],
    "job_id",
  ],
  request_section_edit: [
    "section_edit_request",
    [
      "p_version",
      "p_take",
      "p_engine",
      "p_start",
      "p_end",
      "p_duration",
      "p_lines",
      "p_section",
      "p_full",
    ],
    "edit_id",
  ],
  keep_section_edit: [
    "section_edit_keep",
    ["p_edit", "p_alternative"],
    "take_id",
  ],
  discard_section_edit: ["section_edit_discard", ["p_edit"]],
  choose_take: ["take_choose", ["p_version", "p_take"]],
  keep_audio: ["audio_keep", ["p_version", "p_take"]],
  import_song: [
    "song_import",
    ["p_title", "p_style", "p_lyrics", "p_lang", "p_upload", "p_source"],
    "project_id",
  ],
  set_song_source: ["song_source_set", ["p_version", "p_source"]],
  request_stems: ["stems_request", ["p_version"], "job_id"],
  save_edited_take: ["take_save_edit", ["p_version", "p_path"], "take_id"],
  request_visualizer: [
    "visualizer_request",
    ["p_version", "p_params"],
    "job_id",
  ],
  create_project: [
    "admin_project_create",
    [
      "p_topic",
      "p_brief",
      "p_languages",
      "p_style",
      "p_mood",
      "p_vocal_gender",
    ],
    "project_id",
  ],
  back_to_lyrics: ["lyrics_back", ["p_version"]],
  approve_lyrics: ["lyrics_approve", ["p_version", "p_pack"]],
  pick_take: ["take_pick", ["p_version", "p_take"]],
  make_video: ["video_make", ["p_version"]],
  approve_video: ["video_approve", ["p_version"]],
  enqueue_publish: ["admin_enqueue_publish", ["p_render", "p_metadata"]],
  retry_stage: ["stage_retry", ["p_job"]],
  resolve_upload: [
    "admin_resolve_upload",
    ["p_publication", "p_uploaded", "p_video_id"],
  ],
  resolve_kie_submission: [
    "admin_resolve_kie_submission",
    ["p_version", "p_charged", "p_task_id"],
  ],
};

// Keep the old response shape while the existing database assertions move to ops.
export async function opsRpc(
  client: SupabaseClient,
  name: string,
  params: Record<string, unknown>,
): Promise<{
  // biome-ignore lint/suspicious/noExplicitAny: the legacy assertions read arbitrary result fields
  data: any;
  error: { code: string; message: string } | null;
}> {
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) throw new Error("Authenticated test session required");
  const claims = JSON.parse(
    Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
  );
  if (!claims.session_id) throw new Error("Session ID missing from test token");
  let entry = wrappers[name];
  let input: Record<string, unknown> = params;
  if (name === "create_song") {
    entry = ["song_create", ["p_input"], "project_id"];
    input = {
      p_input: {
        mode: params.p_lyrics ? "advanced" : "simple",
        count: 1,
        prompt: params.p_prompt,
        lyrics: params.p_lyrics,
        languages: params.p_languages,
        styles: params.p_style,
        vocalGender: params.p_vocal_gender,
        settings: params.p_settings,
      },
    };
  } else if (name === "approve_video" && params.p_override_reason) {
    entry = [
      "admin_video_approve_override",
      ["p_version", "p_override_reason"],
    ];
  }
  if (!entry) throw new Error(`No ops wrapper for ${name}`);
  const result = await opsCall(
    { userId: session.user.id, sessionId: claims.session_id },
    entry[0],
    entry[1].map((key) => input[key] ?? null),
  );
  if (!result.ok)
    return {
      data: null,
      error: { code: result.code, message: result.message },
    };
  const data = result.data as Record<string, unknown> & {
    jobs?: { job_id?: unknown }[];
  };
  return {
    data:
      entry[2] === "job_id"
        ? (data.jobs?.[0]?.job_id ?? data.job_id)
        : entry[2]
          ? data[entry[2]]
          : data,
    error: null,
  };
}
