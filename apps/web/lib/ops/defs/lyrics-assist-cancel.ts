import { z } from "zod";
import { define } from "./base";

const input = z.object({
  p_request: z.string().uuid(),
});
export const lyricsAssistCancel = define(
  "lyrics_assist_cancel",
  input,
  (v) => [v.p_request],
  z.object({}),
  "create",
  false,
);
