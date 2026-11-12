import { PickTakeInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const takePick = define(
  "take_pick",
  PickTakeInput,
  (v) => [v.versionId, v.takeId],
  JobsResult,
  "create",
  true,
);
