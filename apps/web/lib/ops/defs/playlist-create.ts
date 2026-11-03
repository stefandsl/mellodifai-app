import { z } from "zod";
import { PlaylistNameInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const playlistCreate = define(
  "playlist_create",
  PlaylistNameInput,
  (v) => [v.name],
  JobsResult.extend({ playlist_id: z.string().uuid() }),
  "create",
  false,
);
