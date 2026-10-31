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
    .update({ lyric_pack: value.pack, status: "song_queued" })
    .eq("id", value.versionId);
  if (error) throw new Error(error.message);
  const { error: jobError } = await supabase.from("jobs").insert({
    version_id: value.versionId,
    stage: "generate_song",
    idempotency_key: `generate_song:${value.versionId}:1`,
  });
  if (jobError) throw new Error(jobError.message);
  refresh(value.versionId);
}

export async function pickTake(input: unknown) {
  const value = PickTakeInput.parse(input);
  const { supabase } = await actionProfile();
  const { error } = await supabase
    .from("versions")
    .update({ chosen_take_id: value.takeId, status: "producing" })
    .eq("id", value.versionId);
  if (error) throw new Error(error.message);
  refresh(value.versionId);
}

export async function generateAgain(input: unknown) {
  const { versionId } = VersionIdInput.parse(input);
  const { supabase } = await actionProfile();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("version_id", versionId)
    .eq("stage", "generate_song");
  if (error) throw new Error(error.message);
  const attempt = (count ?? 0) + 1;
  const { error: jobError } = await supabase.from("jobs").insert({
    version_id: versionId,
    stage: "generate_song",
    idempotency_key: `generate_song:${versionId}:${attempt}`,
  });
  if (jobError) throw new Error(jobError.message);
  refresh(versionId);
}

export async function approveVideo(input: unknown) {
  const value = VideoApprovalInput.parse(input);
  const { supabase } = await actionProfile();
  const { error } = await supabase
    .from("versions")
    .update({ status: "approved" })
    .eq("id", value.versionId);
  if (error) throw new Error(error.message);
  refresh(value.versionId);
}

export async function rerenderVideo(input: unknown) {
  const { versionId } = RerenderInput.parse(input);
  const { supabase } = await actionProfile();
  const { data: version, error } = await supabase
    .from("versions")
    .select("render_attempt")
    .eq("id", versionId)
    .single();
  if (error) throw new Error(error.message);
  const attempt = version.render_attempt + 1;
  const { error: updateError } = await supabase
    .from("versions")
    .update({ render_attempt: attempt, status: "producing" })
    .eq("id", versionId);
  if (updateError) throw new Error(updateError.message);
  const { error: jobError } = await supabase.from("jobs").insert({
    version_id: versionId,
    stage: "timing",
    idempotency_key: `timing:${versionId}:${attempt}`,
  });
  if (jobError) throw new Error(jobError.message);
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
  const { data: publication, error } = await supabase
    .from("publications")
    .insert({
      render_id: value.renderId,
      privacy: "private",
      metadata: value.metadata,
    })
    .select("id")
    .single();
  if (error || !publication)
    throw new Error(error?.message ?? "Unable to create publication");
  const { error: jobError } = await supabase.from("jobs").insert({
    version_id: render.version_id,
    stage: "publish",
    idempotency_key: `publish:${value.renderId}`,
  });
  if (jobError) throw new Error(jobError.message);
  return publication.id;
}

export async function setPrivacy(input: unknown) {
  const value = SetPrivacyInput.parse(input);
  const { supabase, user } = await actionProfile();
  const { data: publication, error } = await supabase
    .from("publications")
    .update({
      privacy: value.privacy,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", value.publicationId)
    .select("render_id, renders(version_id)")
    .single();
  if (error || !publication)
    throw new Error(error?.message ?? "Unable to confirm privacy");
  const render = publication.renders as unknown as {
    version_id: string;
  } | null;
  if (!render) throw new Error("Unable to find render");
  const { error: jobError } = await supabase.from("jobs").insert({
    version_id: render.version_id,
    stage: "set_privacy",
    idempotency_key: `set_privacy:${value.publicationId}:${value.privacy}`,
  });
  if (jobError) throw new Error(jobError.message);
}
