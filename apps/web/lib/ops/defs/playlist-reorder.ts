import { PlaylistReorderInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const playlistReorder = define(
  "playlist_reorder",
  PlaylistReorderInput,
  (v) => [v.playlistId, v.versionIds],
  JobsResult,
  "create",
  false,
);
