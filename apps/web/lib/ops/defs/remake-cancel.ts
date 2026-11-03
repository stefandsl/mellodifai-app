import { z } from "zod";
import { define } from "./base";

const input = z.object({
  p_remake: z.string().uuid(),
});
export const remakeCancel = define(
  "remake_cancel",
  input,
  (v) => [v.p_remake],
  z.object({}),
  "create",
  false,
);
