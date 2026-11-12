import { z } from "zod";
import type { OpDef } from "../types";

const empty = z.object({});
export const styleFormatCheck: OpDef<
  z.infer<typeof empty>,
  z.infer<typeof empty>
> = {
  name: "style_format_check",
  fn: "style_format_check",
  input: empty,
  args: () => [],
  output: empty,
  scope: "create",
  key: false,
  mutating: true,
  revalidate: () => [],
};
