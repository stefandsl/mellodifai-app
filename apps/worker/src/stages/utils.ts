import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Lang, LyricPack } from "@mellodifai/shared";
import type { StageContext } from "../loop.js";

export const ENGINE_ROOT = "C:\\Users\\Asus\\Documents\\suno-remake";
export const PREVIEW_ROOT = "previews";
export function attempt(context: StageContext): number {
  return context.version.render_attempt ?? context.job.attempts ?? 1;
}
export function key(stage: string, context: StageContext): string {
  return `${stage}:${context.version.id}:${attempt(context)}`;
}
export function previewPath(context: StageContext, file: string): string {
  return [
    PREVIEW_ROOT,
    context.version.owner_id ?? "unknown",
    context.project.id,
    context.version.lang,
    file,
  ].join("/");
}
export function versionFile(context: StageContext, file: string): string {
  return join(context.ws.versionsDir, file);
}
export async function writePack(
  context: StageContext,
  pack: LyricPack,
): Promise<void> {
  await mkdir(context.ws.versionsDir, { recursive: true });
  // Names as read by suno-remake/tools/kie.mjs buildJob(); an absent key is not sent to kie.
  const settings = {
    model: pack.settings.model,
    ...(pack.settings.vocalGender
      ? { vocal_gender: pack.settings.vocalGender }
      : {}),
    style_weight: pack.settings.styleWeight,
    weirdness_constraint: pack.settings.weirdness,
    variety: pack.settings.variety,
    ...(pack.settings.duration === null
      ? {}
      : { duration: pack.settings.duration }),
  };
  await Promise.all([
    writeFile(versionFile(context, "lyrics.txt"), pack.lyrics),
    writeFile(versionFile(context, "title.txt"), pack.title),
    writeFile(versionFile(context, "style.txt"), pack.style),
    writeFile(versionFile(context, "settings.json"), JSON.stringify(settings)),
    writeFile(versionFile(context, "exclude.txt"), pack.exclude),
    writeFile(
      versionFile(context, "display-map.json"),
      JSON.stringify(pack.displayMap),
    ),
    writeFile(
      versionFile(context, "storyboard-l10n.json"),
      JSON.stringify(pack.l10n),
    ),
  ]);
  const displayDir = join(context.ws.publicDir, "data", context.version.lang);
  await mkdir(displayDir, { recursive: true });
  await copyFile(
    versionFile(context, "display-map.json"),
    join(displayDir, "display-map.json"),
  );
}
export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}
export async function upload(
  context: StageContext,
  local: string,
  type: string,
): Promise<string> {
  const path = previewPath(context, basename(local));
  await context.storage.upload(path, local, type);
  try {
    if (context.storage.remove) {
      const rows = await context.db.previewRows(context.version.id);
      const live = new Set<string>([path]);
      const obsolete = new Set<string>();
      for (const r of rows.renders) {
        if (r.preview_path)
          ((r.render_attempt ?? 1) < (context.version.render_attempt ?? 1)
            ? obsolete
            : live
          ).add(r.preview_path);
      }
      for (const take of rows.takes)
        for (const file of [
          take.audio_preview_path,
          take.cover_path,
          ...stemPaths(take.stems),
        ])
          if (file)
            ((take.generation ?? 1) < (context.version.generation_count ?? 1)
              ? obsolete
              : live
            ).add(file);
      await context.storage.remove([...obsolete].filter((p) => !live.has(p)));
    }
  } catch (error) {
    try {
      await context.log(
        context.secrets.redact(`Preview cleanup failed: ${String(error)}`),
      );
    } catch {
      /* Cleanup telemetry must not fail a successful upload. */
    }
  }
  return path;
}
// The stored files of a take's stems (stems.ts StemSet), for the preview cleanup.
export function stemPaths(stems: unknown): string[] {
  const tracks =
    stems && typeof stems === "object"
      ? (stems as { tracks?: unknown }).tracks
      : undefined;
  if (!tracks || typeof tracks !== "object") return [];
  return Object.values(tracks).flatMap((track) => {
    const path =
      track && typeof track === "object"
        ? (track as { path?: unknown }).path
        : undefined;
    return typeof path === "string" && path ? [path] : [];
  });
}
export async function engine(
  context: StageContext,
  command: string,
  args: string[],
  cwd = ENGINE_ROOT,
) {
  return context.engine.run(command, args, { cwd });
}
export function language(context: StageContext): Lang {
  return context.version.lang;
}
