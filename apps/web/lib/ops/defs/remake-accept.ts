import { LyricPackSchema, SongSettingsSchema } from "@mellodifai/shared";
import { z } from "zod";
import { define } from "./base";

const input = z.object({
  p_remake: z.string().uuid(),
  p_revision: z.number().int().nonnegative(),
  p_pack: LyricPackSchema,
  p_settings: SongSettingsSchema,
  p_vocal_gender: z.enum(["m", "f"]).nullable(),
});
export const remakeAccept = define(
  "remake_accept",
  input,
  (v) => [v.p_remake, v.p_revision, v.p_pack, v.p_settings, v.p_vocal_gender],
  z.object({ id: z.string().uuid() }),
  "create",
  true,
);
