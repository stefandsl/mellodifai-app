import { PlaylistIdInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const playlistDelete = define(
  "playlist_delete",
  PlaylistIdInput,
  (v) => [v.playlistId],
  JobsResult,
  "create",
  false,
);
