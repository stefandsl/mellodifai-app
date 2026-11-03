import { z } from "zod";
import { define } from "./base";

const input = z.object({
  p_remake: z.string().uuid(),
  p_revision: z.number().int().nonnegative(),
  p_lines: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        text: z.string().min(1).max(200),
      }),
    )
    .max(200),
  p_title: z.string().min(1).max(100).nullable(),
});
export const remakeEdit = define(
  "remake_edit",
  input,
  (v) => [v.p_remake, v.p_revision, v.p_lines, v.p_title],
  z.object({ revision: z.number().int().nonnegative() }),
  "create",
  true,
);
