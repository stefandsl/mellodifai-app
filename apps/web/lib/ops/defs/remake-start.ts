import { LANGS, REMAKE_COUNTRIES } from "@mellodifai/shared";
import { z } from "zod";
import { define } from "./base";

const input = z.object({
  p_url: z.string().min(1).max(500),
  p_video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
  p_lang: z.enum(LANGS),
  p_country: z.enum(REMAKE_COUNTRIES).nullable(),
});
export const remakeStart = define(
  "remake_start",
  input,
  (v) => [v.p_url, v.p_video_id, v.p_lang, v.p_country],
  z.object({ id: z.string().uuid() }),
  "create",
  true,
);
