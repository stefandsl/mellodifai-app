import { z } from "zod";
import { PlaylistSongsInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const playlistAdd = define(
  "playlist_add",
  PlaylistSongsInput,
  (v) => [v.playlistId, v.versionIds],
  JobsResult.extend({ count: z.number() }),
  "create",
  false,
);
