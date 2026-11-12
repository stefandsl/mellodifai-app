import { z } from "zod";
import type { OpDef } from "../types";
import { RemakesListInput } from "./inputs";

const Id = z.string().uuid();
// ops.remakes_list (migration 20261103075001): newest first, without dismissed remakes and
// without songs that left the library.
const output = z.object({
  remakes: z.array(
    z.object({
      remake_id: Id,
      project_id: Id,
      version_id: Id,
      stage: z.string(),
      lang: z.string(),
      title: z.string().nullable(),
      error_code: z.string().nullable(),
      created_at: z.string(),
      updated_at: z.string(),
    }),
  ),
});

export const remakesList: OpDef<
  z.infer<typeof RemakesListInput>,
  z.infer<typeof output>
> = {
  name: "remakes_list",
  fn: "remakes_list",
  input: RemakesListInput,
  args: (v) => [v.limit],
  output,
  scope: "read",
  key: false,
  mutating: false,
  revalidate: () => [],
};
