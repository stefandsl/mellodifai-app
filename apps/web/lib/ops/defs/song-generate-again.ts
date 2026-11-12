import { GenerateAgainInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const songGenerateAgain = define(
  "song_generate_again",
  GenerateAgainInput,
  (v) => [v.versionId, v.generation],
  JobsResult,
  "spend",
  true,
);
