import { z } from "zod";
import { VersionIdInput } from "@/app/actions/schemas";
import { define } from "./base";

export const lyricsBack = define(
  "lyrics_back",
  VersionIdInput,
  (v) => [v.versionId],
  z.object({ version_id: z.string().uuid(), status: z.string() }),
  "create",
  false,
);
