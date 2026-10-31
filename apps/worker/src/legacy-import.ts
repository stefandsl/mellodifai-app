import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LANGS, type Lang } from "@mellodifai/shared";

export const LEGACY_PROJECT_TOPIC = "Va bene, passa (VBP)";
export const LEGACY_PROJECT_BRIEF =
  "Office satire about AI in the workplace, 11 languages";

export type LegacyPack = {
  title: string;
  lyrics: string;
  style: string;
  exclude: string;
  settings: Record<string, unknown>;
  displayMap: Record<string, string>;
  l10n: Record<string, unknown>;
};

export interface LegacyImportDb {
  isComplete(projectId: string, lang: string): Promise<boolean>;
  markComplete(versionId: string): Promise<void>;
  findProject(
    ownerId: string,
    topic: string,
  ): Promise<{ id: string } | undefined>;
  createProject(
    ownerId: string,
    topic: string,
    brief: string,
  ): Promise<{ id: string }>;
  upsertVersion(input: {
    owner_id: string;
    project_id: string;
    lang: string;
    lyric_pack: LegacyPack;
    status: "approved";
    render_attempt: number;
  }): Promise<{ id: string }>;
  upsertTake(input: {
    owner_id: string;
    version_id: string;
    generation: number;
    take_number: number;
  }): Promise<{ id: string }>;
  setChosenTake(versionId: string, takeId: string): Promise<void>;
  upsertRender(input: {
    owner_id: string;
    version_id: string;
    kind: "master" | "hook";
    path: string;
    preview_path?: string;
    qa_results: { gates: unknown[]; imported: true };
    render_attempt: number;
  }): Promise<void>;
}

export interface LegacyImportFiles {
  readPack(lang: Lang): Promise<LegacyPack>;
  videoPath(lang: Lang): string;
  hookPath(lang: Lang): string;
  uploads(
    lang: Lang,
    ownerId: string,
    projectId: string,
  ): Promise<{ path: string; localFile: string; contentType: string }[]>;
  upload?(value: {
    path: string;
    localFile: string;
    contentType: string;
  }): Promise<void>;
}

export async function importLegacy({
  db,
  files,
  ownerId,
  languages = LANGS,
  onLanguage = () => {},
}: {
  db: LegacyImportDb;
  files: LegacyImportFiles;
  ownerId: string;
  languages?: readonly Lang[];
  onLanguage?: (lang: Lang) => void;
}): Promise<void> {
  let project = await db.findProject(ownerId, LEGACY_PROJECT_TOPIC);
  if (!project)
    project = await db.createProject(
      ownerId,
      LEGACY_PROJECT_TOPIC,
      LEGACY_PROJECT_BRIEF,
    );

  for (const lang of languages) {
    if (await db.isComplete(project.id, lang)) {
      onLanguage(lang);
      continue;
    }
    const version = await db.upsertVersion({
      owner_id: ownerId,
      project_id: project.id,
      lang,
      lyric_pack: await files.readPack(lang),
      status: "approved",
      render_attempt: 1,
    });
    const take = await db.upsertTake({
      owner_id: ownerId,
      version_id: version.id,
      generation: 1,
      take_number: 1,
    });
    await db.setChosenTake(version.id, take.id);
    await db.upsertRender({
      owner_id: ownerId,
      version_id: version.id,
      kind: "master",
      path: files.videoPath(lang),
      preview_path: `previews/${ownerId}/${project.id}/${lang}/video-720p.mp4`,
      qa_results: { gates: [], imported: true },
      render_attempt: 1,
    });
    await db.upsertRender({
      owner_id: ownerId,
      version_id: version.id,
      kind: "hook",
      path: files.hookPath(lang),
      qa_results: { gates: [], imported: true },
      render_attempt: 1,
    });
    for (const upload of await files.uploads(lang, ownerId, project.id))
      await files.upload?.(upload);
    await db.markComplete(version.id);
    onLanguage(lang);
  }
}

function camelCaseSettings(settings: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}

export async function optionalText(
  path: string,
  fallback = "",
): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await optionalText(path, "{}")) as Record<string, unknown>;
}

export function createLegacyFiles(
  versionsRoot = "C:\\Users\\Asus\\Documents\\suno-remake\\versions",
  finalRoot = "E:\\suno-remake-render\\out\\final",
): LegacyImportFiles {
  return {
    async readPack(lang) {
      const root = join(versionsRoot, lang);
      return {
        title: (await readFile(join(root, "title.txt"), "utf8")).trim(),
        lyrics: await readFile(join(root, "lyrics.txt"), "utf8"),
        style: (await readFile(join(root, "style.txt"), "utf8")).trim(),
        exclude: await optionalText(join(root, "exclude.txt")),
        settings: camelCaseSettings(
          await readJson(join(root, "settings.json")),
        ),
        displayMap: (await readJson(join(root, "display-map.json"))) as Record<
          string,
          string
        >,
        l10n: await readJson(join(root, "storyboard-l10n.json")),
      };
    },
    videoPath: (lang) => join(finalRoot, lang, "video.mp4"),
    hookPath: (lang) => join(finalRoot, lang, "hook.mp4"),
    async uploads(lang, ownerId, projectId) {
      const root = join(finalRoot, lang);
      const prefix = `previews/${ownerId}/${projectId}/${lang}`;
      const uploads = [
        {
          path: `${prefix}/video-720p.mp4`,
          localFile: join(root, "video-720p.mp4"),
          contentType: "video/mp4",
        },
        {
          path: `${prefix}/${lang}.srt`,
          localFile: join(finalRoot, `${lang}.srt`),
          contentType: "application/x-subrip",
        },
      ];
      const thumbnail = join(root, "thumbnail-1280x720.png");
      try {
        await access(thumbnail);
        uploads.push({
          path: `${prefix}/thumbnail-1280x720.png`,
          localFile: thumbnail,
          contentType: "image/png",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return uploads;
    },
  };
}
