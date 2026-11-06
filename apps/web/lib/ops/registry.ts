import {
  CreateSongInput,
  LyricsApproveInput,
  LyricsBackInput,
  SongGenerateAgainInput,
  StageRetryInput,
  StemsRequestInput,
  TakePickInput,
  VideoApproveInput,
  VideoMakeInput,
  VideoRerenderInput,
  VisualizerInput,
  validateLyricPack,
} from "@mellodifai/shared";
import { JobsResult } from "./defs/base";
import { costsGet } from "./defs/costs-get";
import { jobCancel } from "./defs/job-cancel";
import { jobStatus } from "./defs/job-status";
import { lyricsApprove } from "./defs/lyrics-approve";
import { lyricsBack } from "./defs/lyrics-back";
import { songCreate } from "./defs/song-create";
import { songGenerateAgain } from "./defs/song-generate-again";
import { songGet } from "./defs/song-get";
import { songsList } from "./defs/songs-list";
import { stageRetry } from "./defs/stage-retry";
import { stemsRequest } from "./defs/stems-request";
import { takePick } from "./defs/take-pick";
import { videoApprove } from "./defs/video-approve";
import { videoMake } from "./defs/video-make";
import { videoRerender } from "./defs/video-rerender";
import { visualizerRequest } from "./defs/visualizer-request";
import type { OpDef } from "./types";

export type TokenOp = OpDef<unknown, unknown> & {
  http: { method: "GET" | "POST"; path: string };
};

function http<I, O>(def: OpDef<I, O>, path: string): TokenOp {
  return {
    ...def,
    // Keep heterogeneous definitions type-safe at the registry boundary.
    args: (input) => def.args(def.input.parse(input)),
    revalidate: (data) => def.revalidate(def.output.parse(data)),
    http: { method: def.mutating ? "POST" : "GET", path: `/api/v1${path}` },
  };
}

// Token inputs follow 7.3; cookie action inputs retain their existing camelCase names.
export const tokenOps = {
  songs_list: http(songsList, "/songs"),
  song_get: http(songGet, "/songs/{version_id}"),
  job_status: http(jobStatus, "/jobs/{job_id}"),
  costs_get: http(costsGet, "/costs"),
  song_create: http({ ...songCreate, input: CreateSongInput }, "/songs"),
  lyrics_approve: http(
    {
      ...lyricsApprove,
      input: LyricsApproveInput.refine(
        (v) => validateLyricPack(v.lyric_pack, "vbp").ok,
      ),
      args: (v) =>
        lyricsApprove.args({ versionId: v.version_id, pack: v.lyric_pack }),
    },
    "/songs/{version_id}/lyrics/approve",
  ),
  lyrics_back: http(
    {
      ...lyricsBack,
      input: LyricsBackInput,
      args: (v) => lyricsBack.args({ versionId: v.version_id }),
    },
    "/songs/{version_id}/lyrics/back",
  ),
  song_generate_again: http(
    {
      ...songGenerateAgain,
      input: SongGenerateAgainInput,
      args: (v) =>
        songGenerateAgain.args({
          versionId: v.version_id,
          generation: v.generation,
        }),
    },
    "/songs/{version_id}/generate",
  ),
  take_pick: http(
    {
      ...takePick,
      input: TakePickInput,
      args: (v) =>
        takePick.args({ versionId: v.version_id, takeId: v.take_id }),
    },
    "/songs/{version_id}/takes/{take_id}/pick",
  ),
  video_make: http(
    {
      ...videoMake,
      input: VideoMakeInput,
      args: (v) => videoMake.args({ versionId: v.version_id }),
    },
    "/songs/{version_id}/video",
  ),
  video_rerender: http(
    {
      ...videoRerender,
      input: VideoRerenderInput,
      args: (v) => videoRerender.args({ versionId: v.version_id }),
    },
    "/songs/{version_id}/video/rerender",
  ),
  video_approve: http(
    {
      ...videoApprove,
      input: VideoApproveInput,
      args: (v) => videoApprove.args({ versionId: v.version_id }),
      output: lyricsBack.output,
    },
    "/songs/{version_id}/video/approve",
  ),
  // The cookie retry schema also needs a version for UI revalidation; SQL only takes job_id.
  stage_retry: http(
    { ...stageRetry, input: StageRetryInput, args: (v) => [v.job_id] },
    "/jobs/{job_id}/retry",
  ),
  job_cancel: http(jobCancel, "/jobs/{job_id}/cancel"),
  stems_request: http(
    {
      ...stemsRequest,
      input: StemsRequestInput,
      args: (v) => stemsRequest.args({ versionId: v.version_id }),
      output: JobsResult,
      revalidate: () => [],
    },
    "/songs/{version_id}/stems",
  ),
  visualizer_request: http(
    {
      ...visualizerRequest,
      input: VisualizerInput,
      args: (v) =>
        visualizerRequest.args({ versionId: v.version_id, params: v.params }),
    },
    "/songs/{version_id}/visualizer",
  ),
};

export const TOKEN_OPS: TokenOp[] = Object.values(tokenOps);
