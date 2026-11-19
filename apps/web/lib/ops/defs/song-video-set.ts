import { z } from "zod";
import { define } from "./base";

// R31: the song's video choice while its lyrics are approved (before the take is picked).
export const SongVideoInput = z.object({
  versionId: z.string().uuid(),
  video: z.enum(["lyric", "off", "visualizer"]),
});

export const songVideoSet = define(
  "song_video_set",
  SongVideoInput,
  (v) => [v.versionId, v.video],
  z.object({
    version_id: z.string().uuid(),
    video: z.enum(["lyric", "off", "visualizer"]),
  }),
);
