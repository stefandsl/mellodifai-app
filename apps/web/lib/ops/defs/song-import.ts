import { z } from "zod";
import { ImportSongInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const songImport = define(
  "song_import",
  ImportSongInput,
  (v) => [v.title, v.style, v.lyrics, v.lang, v.upload, v.source],
  JobsResult.extend({ project_id: z.string().uuid() }),
  "create",
  false,
);
