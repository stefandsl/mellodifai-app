"use server";
import { adminConfirmPublication } from "@/lib/ops/defs/admin-confirm-publication";
import { adminEnqueuePublish } from "@/lib/ops/defs/admin-enqueue-publish";
import { adminResolveKieSubmission } from "@/lib/ops/defs/admin-resolve-kie-submission";
import { adminResolveUpload } from "@/lib/ops/defs/admin-resolve-upload";
import { adminVideoApproveOverride } from "@/lib/ops/defs/admin-video-approve-override";
import { audioKeep } from "@/lib/ops/defs/audio-keep";
import { lyricsApprove } from "@/lib/ops/defs/lyrics-approve";
import { lyricsBack } from "@/lib/ops/defs/lyrics-back";
import { songGenerateAgain } from "@/lib/ops/defs/song-generate-again";
import { songVideoSet } from "@/lib/ops/defs/song-video-set";
import { stageRetry } from "@/lib/ops/defs/stage-retry";
import { takePick } from "@/lib/ops/defs/take-pick";
import { videoApprove } from "@/lib/ops/defs/video-approve";
import { videoMake } from "@/lib/ops/defs/video-make";
import { videoRerender } from "@/lib/ops/defs/video-rerender";
import { runAction } from "@/lib/run-action";
import { VideoApprovalInput } from "./schemas";

export async function approveLyrics(input: unknown) {
  return runAction(lyricsApprove, input);
}

// R31: choose the video while approving the lyrics; it is saved at once.
export async function setSongVideo(input: unknown) {
  return runAction(songVideoSet, input);
}

export async function pickTake(input: unknown) {
  return runAction(takePick, input);
}

export async function keepAudio(input: unknown) {
  return runAction(audioKeep, input);
}

export async function makeVideo(input: unknown) {
  return runAction(videoMake, input);
}

export async function generateAgain(input: unknown) {
  return runAction(songGenerateAgain, input);
}

export async function backToLyrics(input: unknown) {
  return runAction(lyricsBack, input);
}

export async function resolveKieSubmission(input: unknown) {
  return runAction(adminResolveKieSubmission, input);
}

export async function resolveUpload(input: unknown) {
  return runAction(adminResolveUpload, input);
}

export async function rerenderVideo(input: unknown) {
  return runAction(videoRerender, input);
}

export async function retryStage(input: unknown) {
  return runAction(stageRetry, input);
}

export async function uploadPrivate(input: unknown) {
  return runAction(adminEnqueuePublish, input);
}

export async function setPrivacy(input: unknown) {
  return runAction(adminConfirmPublication, input);
}

export async function approveVideo(input: unknown) {
  return runAction(
    VideoApprovalInput.safeParse(input).data?.overrideReason
      ? adminVideoApproveOverride
      : videoApprove,
    input,
  );
}
