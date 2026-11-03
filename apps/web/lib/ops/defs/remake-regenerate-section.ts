import { z } from "zod";
import { define } from "./base";

const input = z.object({
  p_remake: z.string().uuid(),
  p_revision: z.number().int().nonnegative(),
  p_section: z.string().min(1).max(40),
});
export const remakeRegenerateSection = define(
  "remake_regenerate_section",
  input,
  (v) => [v.p_remake, v.p_revision, v.p_section],
  z.object({}),
  "create",
  true,
);
