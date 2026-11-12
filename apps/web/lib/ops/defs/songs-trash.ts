import { z } from "zod";
import { VersionIdsInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const songsTrash = define(
  "songs_trash",
  VersionIdsInput,
  (v) => [v.versionIds],
  JobsResult.extend({ count: z.number() }),
  "create",
  false,
);
