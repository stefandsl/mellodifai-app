import { SongSummary, SongsListInput } from "@mellodifai/shared";
import { z } from "zod";
import type { OpDef } from "../types";

const output = z.object({
  songs: z.array(SongSummary),
  next_cursor: z.string().nullable(),
});
export const songsList: OpDef<
  z.infer<typeof SongsListInput>,
  z.infer<typeof output>
> = {
  name: "songs_list",
  fn: "songs_list",
  input: SongsListInput,
  args: (v) => [v.cursor ?? null, v.limit, v.status ?? null, v.include_trashed],
  output,
  scope: "read",
  key: false,
  mutating: false,
  revalidate: () => [],
};
