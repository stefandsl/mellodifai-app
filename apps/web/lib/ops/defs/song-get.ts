import { SongDetail, SongGetInput } from "@mellodifai/shared";
import type { z } from "zod";
import type { OpDef } from "../types";
export const songGet: OpDef<
  z.infer<typeof SongGetInput>,
  z.infer<typeof SongDetail>
> = {
  name: "song_get",
  fn: "song_get",
  input: SongGetInput,
  args: (v) => [v.version_id],
  output: SongDetail,
  scope: "read",
  key: false,
  mutating: false,
  revalidate: () => [],
};
