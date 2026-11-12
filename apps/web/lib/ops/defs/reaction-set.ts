import { ReactionInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const reactionSet = define(
  "reaction_set",
  ReactionInput,
  (v) => [v.versionId, v.reaction],
  JobsResult,
  "create",
  false,
);
