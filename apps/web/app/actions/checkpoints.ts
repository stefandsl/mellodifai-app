"use server";

import { validateLyricPack } from "@mellodifai/shared";
import { revalidatePath } from "next/cache";

import { actionProfile } from "@/lib/auth";
import {
  PickTakeInput,
  PublicationInput,
  RerenderInput,
  SetPrivacyInput,
  UpdateLyricsInput,
  VersionIdInput,
  VideoApprovalInput,
} from "./schemas";

function refresh(versionId: string) {
  revalidatePath(`/projects/${versionId}`);
}

export async function approveLyrics(input: unknown) {
  const value = UpdateLyricsInput.parse(input);
  const valid = validateLyricPack(value.pack, "vbp");
  if (!valid.ok) throw new Error(valid.errors.join("; "));
  const { supabase } = await actionProfile();
  const { error } = await supabase
    .from("versions")
    .update({ lyric_pack: value.pack })
    .eq("id", value.versionId);
  if (error) throw new Error(error.message);
  const { error: jobError } = await supabase.rpc("transition_version", {
    p_version: value.versionId,
    p_action: "approve_lyrics",
  });
  if (jobError) throw new Error(jobError.message);
  refresh(value.versionId);
}

export async function pickTake(input: unknown) {
  const value = PickTakeInput.parse(input);
  const { supabase } = await actionProfile();
  const { error } = await supabase.rpc("transition_version", {
    p_version: value.versionId,
    p_action: "pick_take",
    p_take: value.takeId,
  });
  if (error) throw new Error(error.message);
  refresh(value.versionId);
}

export async function generateAgain(input: unknown) {
  const { versionId } = VersionIdInput.parse(input);
  const { supabase } = await actionProfile();
  const { error } = await supabase.rpc("transition_version", {
    p_version: versionId,
    p_action: "generate_again",
  });
  if (error) throw new Error(error.message);
  refresh(versionId);
}

export async function approveVideo(input: unknown) {
  const value = VideoApprovalInput.parse(input);
  const { supabase } = await actionProfile();
  const { error } = await supabase.rpc("transition_version", {
    p_version: value.versionId,
    p_action: "approve_video",
  });
  if (error) throw new Error(error.message);
  refresh(value.versionId);
}

export async function rerenderVideo(input: unknown) {
  const { versionId } = RerenderInput.parse(input);
  const { supabase } = await actionProfile();
  const { error } = await supabase.rpc("transition_version", {
    p_version: versionId,
    p_action: "render_again",
  });
  if (error) throw new Error(error.message);
  refresh(versionId);
}

export async function uploadPrivate(input: unknown) {
  const value = PublicationInput.parse(input);
  const { supabase } = await actionProfile();
  const { data: render, error: renderError } = await supabase
    .from("renders")
    .select("version_id")
    .eq("id", value.renderId)
    .single();
  if (renderError || !render)
    throw new Error(renderError?.message ?? "Unable to find render");
  const { error: jobError } = await supabase.from("jobs").insert({
    version_id: render.version_id,
    stage: "publish",
    idempotency_key: `publish:${value.renderId}`,
    payload: { render_id: value.renderId, metadata: value.metadata },
  });
  if (jobError) throw new Error(jobError.message);
  refresh(render.version_id);
}

export async function setPrivacy(input: unknown) {
  const value = SetPrivacyInput.parse(input);
  const { supabase } = await actionProfile();
  const { error } = await supabase.rpc("confirm_publication", {
    p_publication: value.publicationId,
    p_privacy: value.privacy,
    p_publish_at: value.publishAt ?? null,
  });
  if (error) throw new Error(error.message);
}
