import { z } from "zod";

// Models offered by the studio model selector, as kie names them.
export const SONG_MODELS = [
  "V6",
  "V6_WILD",
  "V6_MINI",
  "V5",
  "V4_5PLUS",
  "V4_5",
] as const;
export type SongModel = (typeof SONG_MODELS)[number];

// kie is the paid Suno service; the others run on the worker PC through ComfyUI (admin only).
export const SONG_ENGINES = ["kie", "ace-step", "yue2"] as const;
export type SongEngine = (typeof SONG_ENGINES)[number];
export type LocalSongEngine = Exclude<SongEngine, "kie">;

// What the studio create form stores on a project for the worker.
// duration null means Auto (no target length sent to kie).
export const SongSettingsSchema = z.object({
  model: z.enum(SONG_MODELS).default("V6"),
  title: z.string().trim().max(80).optional(),
  exclude: z.string().trim().max(1000).optional(),
  weirdness: z.number().min(0).max(1).optional(),
  styleWeight: z.number().min(0).max(1).optional(),
  variety: z.number().int().min(0).max(4).optional(),
  duration: z.number().int().min(10).max(360).nullable().optional(),
  // "off" makes Keep audio only the suggested choice when picking the take.
  video: z.enum(["lyric", "off"]).optional(),
  engine: z.enum(SONG_ENGINES).default("kie"),
});
export type SongSettings = z.infer<typeof SongSettingsSchema>;
