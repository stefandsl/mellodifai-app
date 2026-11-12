import { z } from "zod";
import { VersionIdsInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const songsRestore = define(
  "songs_restore",
  VersionIdsInput,
  (v) => [v.versionIds],
  JobsResult.extend({ count: z.number() }),
  "create",
  false,
);
