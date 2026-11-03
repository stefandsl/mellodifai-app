import { z } from "zod";
import { PickTakeInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";
import { KeepAudioVisualizerInput } from "./inputs";

export const audioKeep = define(
  "audio_keep",
  PickTakeInput,
  (v) => [v.versionId, v.takeId],
  JobsResult.extend({ version_id: z.string().uuid() }),
  "create",
  true,
);

export const audioKeepForVisualizer = {
  ...audioKeep,
  input: KeepAudioVisualizerInput,
};
