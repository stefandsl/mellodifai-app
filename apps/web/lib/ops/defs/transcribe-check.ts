import { z } from "zod";
import type { OpDef } from "../types";

const empty = z.object({});
export const transcribeCheck: OpDef<
  z.infer<typeof empty>,
  z.infer<typeof empty>
> = {
  name: "transcribe_check",
  fn: "transcribe_check",
  input: empty,
  args: () => [],
  output: empty,
  scope: "create",
  key: false,
  mutating: true,
  revalidate: () => [],
};
