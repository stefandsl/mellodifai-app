// The music-video storyboard operations (ops.music_video_* in the database). Agents use them
// through the token registry; the plan request starts the free rung-1 stage.
import {
  MusicVideoElementUpdateInput,
  MusicVideoShotUpdateInput,
  MusicVideoStoryboardInput,
  MusicVideoStoryboardOutput,
  MusicVideoTakeQuote,
  MusicVideoTakeRequestInput,
  MvElementSchema,
  MvShotSchema,
} from "@mellodifai/shared";
import { z } from "zod";
import type { OpDef } from "../types";
import { JobsResult } from "./base";

export const musicVideoStoryboard: OpDef<
  z.infer<typeof MusicVideoStoryboardInput>,
  z.infer<typeof MusicVideoStoryboardOutput>
> = {
  name: "music_video_storyboard",
  fn: "music_video_storyboard",
  input: MusicVideoStoryboardInput,
  args: (v) => [v.version_id],
  output: MusicVideoStoryboardOutput,
  scope: "read",
  key: false,
  mutating: false,
  revalidate: () => [],
};

function write<I, O>(
  name: string,
  input: z.ZodType<I>,
  args: (value: I) => unknown[],
  output: z.ZodType<O>,
): OpDef<I, O> {
  return {
    name,
    fn: name,
    input,
    args,
    output,
    scope: "create",
    key: true,
    mutating: true,
    // A take request only quotes a price and the plan stage is free: nothing reserves spend.
    reservesPaidWork: false,
    revalidate: () => [],
  };
}

export const MusicVideoPlanInput = z.object({ version_id: z.string().uuid() });

export const musicVideoPlanRequest = write(
  "music_video_plan_request",
  MusicVideoPlanInput,
  (v) => [v.version_id],
  JobsResult,
);

export const musicVideoElementUpdate = write(
  "music_video_element_update",
  MusicVideoElementUpdateInput,
  (v) => [v.element_id, v.patch],
  z.object({ element: MvElementSchema }),
);

export const musicVideoShotUpdate = write(
  "music_video_shot_update",
  MusicVideoShotUpdateInput,
  (v) => [v.shot_id, v.patch],
  z.object({ shot: MvShotSchema }),
);

export const musicVideoTakeRequest = write(
  "music_video_take_request",
  MusicVideoTakeRequestInput,
  (v) => [v.shot_id, v.phase],
  MusicVideoTakeQuote,
);
