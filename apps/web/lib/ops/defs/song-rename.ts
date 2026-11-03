import { RenameInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const songRename = define(
  "song_rename",
  RenameInput,
  (v) => [v.versionId, v.title],
  JobsResult,
  "create",
  false,
);
