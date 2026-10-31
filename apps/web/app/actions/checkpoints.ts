"use server";
import { validateLyricPack } from "@mellodifai/shared";
import { z } from "zod";
import { runAction } from "@/lib/run-action";
import {
  GenerateAgainInput,
  PickTakeInput,
  PublicationInput,
  RetryInput,
  SetPrivacyInput,
  UpdateLyricsInput,
  VersionIdInput,
  VideoApprovalInput,
} from "./schemas";
export async function approveLyrics(input: unknown) {
  return runAction(async (db) => {
    const v = UpdateLyricsInput.parse(input);
    if (!validateLyricPack(v.pack, "vbp").ok) throw new Error("invalid pack");
    const { error } = await db.rpc("approve_lyrics", {
      p_version: v.versionId,
      p_pack: v.pack,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}
export async function pickTake(input: unknown) {
  return runAction(async (db) => {
    const v = PickTakeInput.parse(input);
    const { error } = await db.rpc("pick_take", {
      p_version: v.versionId,
      p_take: v.takeId,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}
export async function generateAgain(input: unknown) {
  return runAction(async (db) => {
    const v = GenerateAgainInput.parse(input);
    const { error } = await db.rpc("generate_again", {
      p_version: v.versionId,
      p_generation: v.generation,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}
export async function backToLyrics(input: unknown) {
  return runAction(async (db) => {
    const v = VersionIdInput.parse(input);
    const { error } = await db.rpc("back_to_lyrics", {
      p_version: v.versionId,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}
export async function resolveKieSubmission(input: unknown) {
  return runAction(async (db) => {
    const v = VersionIdInput.extend({
      charged: z.boolean(),
      taskId: z.string().trim().max(200).optional(),
    }).parse(input);
    const { error } = await db.rpc("resolve_kie_submission", {
      p_version: v.versionId,
      p_charged: v.charged,
      p_task_id: v.taskId ?? null,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}
export async function resolveUpload(input: unknown) {
  return runAction(async (db) => {
    const v = z
      .object({
        publicationId: z.string().uuid(),
        uploaded: z.boolean(),
        videoId: z
          .string()
          .trim()
          .regex(/^[\w-]+$/u)
          .max(200)
          .optional(),
      })
      .refine((v) => !v.uploaded || Boolean(v.videoId))
      .parse(input);
    const { data: publication, error: readError } = await db
      .from("publications")
      .select("render_id")
      .eq("id", v.publicationId)
      .single();
    if (readError) throw readError;
    const { data: render, error: renderError } = await db
      .from("renders")
      .select("version_id")
      .eq("id", publication.render_id)
      .single();
    if (renderError) throw renderError;
    const { error } = await db.rpc("resolve_upload", {
      p_publication: v.publicationId,
      p_uploaded: v.uploaded,
      p_video_id: v.videoId ?? null,
    });
    if (error) throw error;
    return { versionId: render.version_id };
  });
}
export async function approveVideo(input: unknown) {
  return runAction(async (db) => {
    const v = VideoApprovalInput.parse(input);
    const { error } = await db.rpc("approve_video", {
      p_version: v.versionId,
      p_override_reason: v.overrideReason ?? null,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}
export async function rerenderVideo(input: unknown) {
  return runAction(async (db) => {
    const v = VersionIdInput.parse(input);
    const { error } = await db.rpc("render_again", { p_version: v.versionId });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}
export async function retryStage(input: unknown) {
  return runAction(async (db) => {
    const v = RetryInput.parse(input);
    const { error } = await db.rpc("retry_stage", {
      p_version: v.versionId,
      p_job: v.jobId,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}
export async function uploadPrivate(input: unknown) {
  return runAction(async (db) => {
    const v = PublicationInput.parse(input);
    const { data: r, error: readError } = await db
      .from("renders")
      .select("version_id")
      .eq("id", v.renderId)
      .single();
    if (readError) throw readError;
    const { error } = await db.rpc("enqueue_publish", {
      p_render: v.renderId,
      p_metadata: v.metadata,
    });
    if (error) throw error;
    return { versionId: r.version_id };
  });
}
export async function setPrivacy(input: unknown) {
  return runAction(async (db) => {
    const v = SetPrivacyInput.parse(input);
    const { data: p, error: readError } = await db
      .from("publications")
      .select("render_id")
      .eq("id", v.publicationId)
      .single();
    if (readError) throw readError;
    const { data: r, error: renderError } = await db
      .from("renders")
      .select("version_id")
      .eq("id", p.render_id)
      .single();
    if (renderError) throw renderError;
    const { error } = await db.rpc("confirm_publication", {
      p_publication: v.publicationId,
      p_privacy: v.privacy,
      p_publish_at: v.publishAt ?? null,
    });
    if (error) throw error;
    return { versionId: r.version_id };
  });
}
