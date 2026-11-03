"use server";
// "Rifai da YouTube" (task 27): the create panel's actions on a remake. The database functions
// of migration 20261102000025 hold every rule; these validate the input, compose the lyric pack
// with shared remakeLyricsText (the database refuses any other text) and return a code the panel
// turns into a message.
import {
  LANGS,
  LyricPackSchema,
  REMAKE_COUNTRIES,
  RemakeLyricsSchema,
  remakeLyricsText,
  SongSettingsSchema,
  youtubeVideoId,
} from "@mellodifai/shared";
import { headers } from "next/headers";
import { z } from "zod";
import { actionProfile } from "@/lib/auth";
import { sessionCtx } from "@/lib/ops/context";
import { remakeAccept } from "@/lib/ops/defs/remake-accept";
import { remakeCancel } from "@/lib/ops/defs/remake-cancel";
import { remakeDismiss } from "@/lib/ops/defs/remake-dismiss";
import { remakeEdit } from "@/lib/ops/defs/remake-edit";
import { remakeRegenerateSection } from "@/lib/ops/defs/remake-regenerate-section";
import { remakeRetry } from "@/lib/ops/defs/remake-retry";
import { remakeStart } from "@/lib/ops/defs/remake-start";
import { runOp } from "@/lib/ops/run";
import type { OpDef } from "@/lib/ops/types";
import { isRemote } from "@/lib/remote";

export type RemakeActionError =
  | "invalidUrl"
  | "busy"
  | "limit"
  | "conflict"
  | "gate"
  | "wait"
  | "notReady"
  | "failed";
export type RemakeActionResult =
  | { ok: true; id?: string; revision?: number; committed?: boolean }
  | { ok: false; error: RemakeActionError; idempotencyKey?: string };

const Id = z.string().uuid();
const Revision = z.number().int().nonnegative();

// Database refusals the person can act on, by the words of migration 20261102000025.
function codeOf(message: string): RemakeActionError {
  if (/invalid youtube link/u.test(message)) return "invalidUrl";
  if (/already running/u.test(message)) return "busy";
  if (/daily remake limit/u.test(message)) return "limit";
  if (/conflict|differ from the reviewed/u.test(message)) return "conflict";
  if (/originality gate/u.test(message)) return "gate";
  if (/wait for the running step/u.test(message)) return "wait";
  if (
    /review required|remake still running|failed remake required/u.test(message)
  )
    return "notReady";
  return "failed";
}

async function invoke<I, O>(
  def: OpDef<I, O>,
  input: I,
): Promise<O | { committed: true }> {
  const result = await runOp(def, await sessionCtx(), input);
  if (!result.ok) throw result;
  return "committed" in result ? { committed: true } : result.data;
}

async function run(
  work: () => Promise<{ id?: string; revision?: number; committed?: boolean }>,
  invalid: RemakeActionError = "failed",
): Promise<RemakeActionResult> {
  try {
    return { ok: true, ...(await work()) };
  } catch (error) {
    const failure = error as {
      message?: string;
      details?: { action_error?: string };
      idempotency_key?: string;
    };
    const code =
      error instanceof z.ZodError ? invalid : codeOf(failure.message ?? "");
    const known = z
      .enum([
        "invalidUrl",
        "busy",
        "limit",
        "conflict",
        "gate",
        "wait",
        "notReady",
      ])
      .safeParse(failure.details?.action_error);
    return {
      ok: false,
      error: known.success ? known.data : code,
      ...(failure.idempotency_key
        ? { idempotencyKey: failure.idempotency_key }
        : {}),
    };
  }
}

const StartInput = z.object({
  url: z.string().trim().min(1).max(500),
  lang: z.enum(LANGS),
  country: z.enum(REMAKE_COUNTRIES).nullable().default(null),
});

export async function startRemake(input: unknown) {
  if (isRemote(await headers()))
    return { ok: false as const, error: "failed" as const };
  return run(async () => {
    const v = StartInput.parse(input);
    const videoId = youtubeVideoId(v.url);
    if (!videoId) throw new Error("invalid youtube link");
    const url = /^https?:\/\//iu.test(v.url) ? v.url : `https://${v.url}`;
    return invoke(remakeStart, {
      p_url: /^[\w-]{11}$/u.test(v.url)
        ? `https://www.youtube.com/watch?v=${videoId}`
        : url,
      p_video_id: videoId,
      p_lang: v.lang,
      p_country: v.country,
    });
  }, "invalidUrl");
}

const EditInput = z.object({
  remakeId: Id,
  revision: Revision,
  lines: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        text: z
          .string()
          .trim()
          .min(1)
          .max(200)
          // One line, and never the em dash (owner rule).
          .refine(
            (t) =>
              !/[\r\n]/u.test(t) && !t.includes(String.fromCodePoint(0x2014)),
          ),
      }),
    )
    .max(200),
  title: z.string().trim().min(1).max(100).nullable().default(null),
});

export async function editRemake(input: unknown) {
  if (isRemote(await headers()))
    return { ok: false as const, error: "failed" as const };
  return run(async () => {
    const v = EditInput.parse(input);
    return invoke(remakeEdit, {
      p_remake: v.remakeId,
      p_revision: v.revision,
      p_lines: v.lines,
      p_title: v.title,
    });
  });
}

const SectionInput = z.object({
  remakeId: Id,
  revision: Revision,
  section: z.string().min(1).max(40),
});

export async function regenerateRemakeSection(input: unknown) {
  if (isRemote(await headers()))
    return { ok: false as const, error: "failed" as const };
  return run(async () => {
    const v = SectionInput.parse(input);
    return invoke(remakeRegenerateSection, {
      p_remake: v.remakeId,
      p_revision: v.revision,
      p_section: v.section,
    });
  });
}

const AcceptInput = z.object({
  remakeId: Id,
  revision: Revision,
  // The studio's title limit (create panel and song settings).
  title: z.string().trim().min(1).max(80),
  style: z.string().trim().min(1).max(1000),
  vocalGender: z.enum(["m", "f"]).nullable(),
  // The create panel's song settings (engine, model, video, tuning), like createSong sends.
  settings: SongSettingsSchema,
});

export async function acceptRemake(input: unknown) {
  if (isRemote(await headers()))
    return { ok: false as const, error: "failed" as const };
  return run(async () => {
    const v = AcceptInput.parse(input);
    const { supabase } = await actionProfile();
    const { data: row, error: readError } = await supabase
      .from("remakes")
      .select("lyrics")
      .eq("id", v.remakeId)
      .single();
    if (readError) throw readError;
    const lyrics = RemakeLyricsSchema.parse(row.lyrics);
    const settings = { ...v.settings, title: v.title };
    // A remake never starts from audio: the reference is the YouTube source, analysed only.
    delete (settings as { source?: unknown }).source;
    const pack = LyricPackSchema.parse({
      title: v.title,
      lyrics: remakeLyricsText(lyrics),
      style: v.style,
      exclude: v.settings.exclude ?? "",
      settings: {
        model: v.settings.model,
        ...(v.vocalGender ? { vocalGender: v.vocalGender } : {}),
        styleWeight: v.settings.styleWeight ?? 0.7,
        weirdness: v.settings.weirdness ?? 0.35,
        variety: v.settings.variety ?? 1,
        duration: v.settings.duration ?? null,
      },
      displayMap: {},
      l10n: {},
    });
    return invoke(remakeAccept, {
      p_remake: v.remakeId,
      p_revision: v.revision,
      p_pack: pack,
      p_settings: settings,
      p_vocal_gender: v.vocalGender,
    });
  });
}

const RemakeIdInput = z.object({ remakeId: Id });

export async function cancelRemake(input: unknown) {
  if (isRemote(await headers()))
    return { ok: false as const, error: "failed" as const };
  return run(async () => {
    return invoke(remakeCancel, {
      p_remake: RemakeIdInput.parse(input).remakeId,
    });
  });
}

export async function dismissRemake(input: unknown) {
  if (isRemote(await headers()))
    return { ok: false as const, error: "failed" as const };
  return run(async () => {
    return invoke(remakeDismiss, {
      p_remake: RemakeIdInput.parse(input).remakeId,
    });
  });
}

export async function retryRemake(input: unknown) {
  if (isRemote(await headers()))
    return { ok: false as const, error: "failed" as const };
  return run(async () => {
    return invoke(remakeRetry, {
      p_remake: RemakeIdInput.parse(input).remakeId,
    });
  });
}
