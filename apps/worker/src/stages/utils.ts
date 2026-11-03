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
  const renderAsset =
    /^(master-preview|hook-preview|thumbnail|contact-sheet)\./u.test(file) ||
    file === `${context.version.lang}.srt`;
  return [
    PREVIEW_ROOT,
    context.version.owner_id ?? "unknown",
    context.project.id,
    context.version.lang,
    ...(renderAsset
      ? [context.version.id, String(context.version.render_attempt ?? 1)]
      : []),
    file,
  ].join("/");
}
export function renderAssetPath(
  context: StageContext,
  renderAttempt: number,
  path: string,
  file: RegExp,
): boolean {
  const prefix = `previews/${context.version.owner_id}/${context.project.id}/${context.version.lang}/${context.version.id}/${renderAttempt}/`;
  const legacyPrefix = `previews/${context.version.owner_id}/${context.project.id}/${context.version.lang}/`;
  if (path.startsWith(prefix)) return file.test(path.slice(prefix.length));
  const legacyName = path.slice(legacyPrefix.length);
  return (
    path.startsWith(legacyPrefix) &&
    !legacyName.includes("/") &&
    file.test(legacyName)
  );
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
      const published = new Set(rows.publishedRenderIds);
      const pending = rows.renders.find(
        (r) =>
          r.kind === "master" &&
          r.render_attempt === context.version.render_attempt,
      );
      const sourceThumbnail = (
        pending?.qa_results as { assets?: { thumbnail_path?: unknown } } | null
      )?.assets?.thumbnail_path;
      if (
        typeof sourceThumbnail === "string" &&
        renderAssetPath(
          context,
          (context.version.render_attempt ?? 1) - 1,
          sourceThumbnail,
          /^thumbnail(?:-1280x720)?\.(?:png|jpg|jpeg|webp)$/u,
        )
      )
        live.add(sourceThumbnail);
      for (const r of rows.renders) {
        // A visualizer video belongs to no render attempt: a new lyric video leaves it alone.
        const thumbnail = (
          r.qa_results as { assets?: { thumbnail_path?: unknown } } | null
        )?.assets?.thumbnail_path;
        const files =
          r.kind === "visualizer"
            ? r.preview_path
              ? [r.preview_path, posterOf(r.preview_path)]
              : []
            : [r.preview_path, thumbnail].filter(
                (file): file is string =>
                  typeof file === "string" && Boolean(file),
              );
        for (const file of files) {
          if (
            !renderAssetPath(
              context,
              r.render_attempt ?? 1,
              file,
              r.kind === "visualizer"
                ? /^(?:visualizer-[^/]+)\.(?:mp4|jpg)$/u
                : /^(?:master-preview\.mp4|hook-preview\.mp4|thumbnail(?:-1280x720)?\.(?:png|jpg|jpeg|webp))$/u,
            )
          )
            continue;
          (r.kind !== "visualizer" &&
          !published.has(r.id) &&
          (r.render_attempt ?? 1) < (context.version.render_attempt ?? 1)
            ? obsolete
            : live
          ).add(file);
        }
      }
      for (const take of rows.takes)
        for (const file of [
          take.audio_preview_path,
          take.cover_path,
          ...stemPaths(take.stems),
        ])
          if (
            file?.startsWith(
              `previews/${context.version.owner_id}/${context.project.id}/${context.version.lang}/`,
            ) &&
            !file
              .slice(
                `previews/${context.version.owner_id}/${context.project.id}/${context.version.lang}/`
                  .length,
              )
              .includes("/")
          )
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
// The still frame stored beside a visualizer video (stages/visualizer.ts).
export function posterOf(videoPath: string): string {
  return videoPath.replace(/\.mp4$/u, ".jpg");
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
