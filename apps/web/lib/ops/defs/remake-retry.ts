import { z } from "zod";
import { define } from "./base";

const input = z.object({
  p_remake: z.string().uuid(),
});
export const remakeRetry = define(
  "remake_retry",
  input,
  (v) => [v.p_remake],
  z.object({}),
  "create",
  true,
);
