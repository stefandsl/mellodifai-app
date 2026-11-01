import { z } from "zod";

import { SONG_MODELS } from "./song-settings.js";

export const LyricPackSchema = z.object({
  title: z.string().min(1).max(100),
  lyrics: z.string(),
  style: z.string().min(1).max(1000),
  exclude: z.string(),
  settings: z.object({
    model: z.enum(SONG_MODELS),
    // Absent means no preference.
    vocalGender: z.enum(["m", "f"]).optional(),
    styleWeight: z.number().min(0).max(1).default(0.7),
    weirdness: z.number().min(0).max(1).default(0.35),
    variety: z.number().int().min(0).max(4).default(1),
    // null means Auto: no target length is sent to kie.
    duration: z.number().int().min(10).max(360).nullable().default(310),
  }),
  displayMap: z.record(z.string(), z.string()),
  l10n: z.record(z.string(), z.unknown()),
});

export type LyricPack = z.infer<typeof LyricPackSchema>;
export type LyricPackTheme = "vbp" | "general";
export type LyricPackValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

function emDashErrors(value: unknown, path = ""): string[] {
  if (typeof value === "string") {
    return value.includes(String.fromCodePoint(0x2014))
      ? [`${path || "value"} contains an em dash`]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      emDashErrors(item, `${path}[${index}]`),
    );
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      emDashErrors(item, path ? `${path}.${key}` : key),
    );
  }

  return [];
}

export function sungLineCount(lyrics: string): number {
  return lyrics.split(/\r?\n/u).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("[");
  }).length;
}

// ACE-Step renders exactly the length it is given and has no ending of its own, so the length
// follows the lyrics: 3.2 s per sung line plus 25 s, between 120 and 300 s (bake-off, design 14).
export function aceStepSeconds(lyrics: string): number {
  const seconds = Math.round(3.2 * sungLineCount(lyrics) + 25);
  return Math.min(300, Math.max(120, seconds));
}

export function validateLyricPack(
  pack: unknown,
  theme: LyricPackTheme,
): LyricPackValidation {
  const parsed = LyricPackSchema.safeParse(pack);
  const errors = parsed.success
    ? []
    : parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "pack"}: ${issue.message}`,
      );

  errors.push(...emDashErrors(pack));

  if (
    theme === "vbp" &&
    typeof (pack as { lyrics?: unknown }).lyrics === "string"
  ) {
    const count = sungLineCount((pack as { lyrics: string }).lyrics);
    if (count !== 80) {
      errors.push(
        `lyrics must contain exactly 80 sung lines for the vbp theme (found ${count})`,
      );
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
