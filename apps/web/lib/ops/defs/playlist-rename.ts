import { PlaylistRenameInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const playlistRename = define(
  "playlist_rename",
  PlaylistRenameInput,
  (v) => [v.playlistId, v.name],
  JobsResult,
  "create",
  false,
);
