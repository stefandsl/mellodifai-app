import { z } from "zod";
import { CreateSongInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const songCreate = define(
  "song_create",
  CreateSongInput,
  (v) => [v],
  JobsResult.extend({ project_id: z.string().uuid() }),
  "spend",
  true,
);
