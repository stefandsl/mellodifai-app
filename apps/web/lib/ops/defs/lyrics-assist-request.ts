import { LANGS } from "@mellodifai/shared";
import { z } from "zod";
import { define } from "./base";

const input = z.object({
  p_mode: z.enum(["write", "regenerate", "improve"]),
  p_lang: z.enum(LANGS),
  p_input: z.record(z.string(), z.unknown()),
});
export const lyricsAssistRequest = define(
  "lyrics_assist_request",
  input,
  (v) => [v.p_mode, v.p_lang, v.p_input],
  z.object({ id: z.string().uuid() }),
  "create",
  true,
);
