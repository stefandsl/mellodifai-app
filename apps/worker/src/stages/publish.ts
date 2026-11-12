import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  LyricPackSchema,
  privacyVersionStatus,
  publicationDefaults,
  songMood,
} from "@mellodifai/shared";
import type { Render } from "../db.js";
import type { StageContext, StageHandler } from "../loop.js";
import { nextPacificQuotaTime } from "./quota.js";
import { ENGINE_ROOT, language } from "./utils.js";

export async function assertPublishRender(
  context: StageContext,
  render: Render | null,
): Promise<Render & { path: string }> {
  if (!render?.path)
    throw new Error("approved current publish render required");
  if (
    render.version_id !== context.version.id ||
    render.owner_id !== context.job.owner_id ||
    render.render_attempt !== context.version.render_attempt ||
    !["approved", "publishing"].includes(context.version.status)
  )
    throw new Error("approved current publish render required");
  if (render.kind === "master") {
    if (!render.approved_at) throw new Error("approved master required");
  } else if (render.kind === "visualizer") {
    const master = await context.db.getRender(context.version.id, "master");
    if (
      render.aspect !== "16:9" ||
      !render.preview_path ||
      master?.render_attempt !== context.version.render_attempt ||
      !master?.approved_at
    )
      throw new Error("approved landscape visualizer required");
  } else throw new Error("publish render kind is not allowed");
  return { ...render, path: render.path };
}

export const publish: StageHandler = async (context) => {
  const workerId =
    context.secrets.values.WORKER_ID ??
    `worker-${process.env.COMPUTERNAME ?? "pc"}`;
  const renderId = (context.job.payload as { render_id?: string } | null)
    ?.render_id;
  const selected = renderId
    ? await context.db.getRenderById(renderId)
    : await context.db.getRender(context.version.id, "master");
  const render = await assertPublishRender(context, selected);
  const prior = await context.db.getPublicationForRender(render.id);
  if (prior?.render_id === render.id && prior.upload_state === "uploading")
    throw new Error("upload state unknown, check YouTube Studio");
  if (prior?.render_id === render.id && prior.upload_state === "uploaded")
    return { versionStatus: "approved" };
  const inside = (root: string, path: string) => {
    const rel = relative(root, path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw new Error("Render path is outside workspace");
  };
  inside(resolve(context.ws.root), resolve(render.path));
  inside(await realpath(context.ws.root), await realpath(render.path));
  const reservation = await context.db.reserveUpload(render, workerId);
  if (reservation.kind === "quota")
    return {
      retryLater: {
        reason: "YouTube daily upload quota reached",
        notBefore: nextPacificQuotaTime(),
      },
    };
  if (reservation.kind === "uploading")
    throw new Error("upload state unknown, check YouTube Studio");
  if (reservation.kind === "uploaded") return { versionStatus: "approved" };
  if (!reservation.publication) throw new Error("Missing upload reservation");
  const assets = (
    render.qa_results as {
      assets?: {
        lyric_pack?: unknown;
        lang?: string;
        storyboard_sections?: unknown;
        mood?: string;
      };
    } | null
  )?.assets;
  const pack = LyricPackSchema.parse(
    assets?.lyric_pack ?? context.version.lyric_pack,
  );
  const lang = assets?.lang ?? language(context);
  const defaults = publicationDefaults(
    pack.title,
    pack.lyrics,
    lang,
    assets?.storyboard_sections ?? context.version.storyboard_sections,
    assets?.mood ??
      songMood(
        context.project.mood,
        (context.project.song_settings as { mood?: string } | null)?.mood,
        pack.style,
      ),
  );
  const requested = context.job.payload?.metadata as
    | { title?: string; description?: string; tags?: string; chapters?: string }
    | undefined;
  const meta = {
    video: render.path,
    captions: join(dirname(render.path), `${lang}.srt`),
    captions_name: pack.title,
    thumbnail: join(dirname(render.path), "thumbnail.png"),
    title: requested?.title?.trim() || defaults.title,
    description: [
      requested?.description?.trim() || defaults.description,
      requested?.chapters ?? defaults.chapters,
    ]
      .filter(Boolean)
      .join("\n\n"),
    tags:
      (requested?.tags?.trim() || defaults.tags)
        ?.split(",")
        .map((tag) => tag.trim())
        .filter(Boolean) ?? [],
    categoryId: "10",
    defaultLanguage: lang,
    defaultAudioLanguage: lang,
    privacyStatus: "private",
    publishAt: null,
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: true,
    embeddable: true,
    license: "youtube",
    playlist: null,
  };
  const folder = join(context.ws.root, "publish", "meta");
  await mkdir(folder, { recursive: true });
  const file = join(folder, `${language(context)}.json`);
  await writeFile(file, JSON.stringify(meta));
  let output = "";
  const runner = context.engine.withWorkspace(
    context.ws.root,
    async (line) => {
      output += `${line}\n`;
      await context.log(line);
    },
    context.signal,
  );
  await runner.run(
    "python",
    ["-I", "-X", "utf8", "publish/yt.py", "upload", file],
    { cwd: ENGINE_ROOT, allowNonZero: true },
  );
  const videoId = /video id\s+([\w-]+)/iu.exec(output)?.[1];
  if (!videoId)
    throw new Error("YouTube upload outcome unknown; check YouTube Studio");
  await context.db.patchPublication(reservation.publication.id, {
    upload_state: "uploaded",
    privacy_applied: "private",
    youtube_video_id: videoId,
    privacy: "private",
    metadata: meta,
  });
  return { versionStatus: "approved" };
};
export const setPrivacy: StageHandler = async (context) => {
  const publication = await context.db.getPublicationForVersion(
    context.version.id,
  );
  if (!publication?.youtube_video_id)
    throw new Error("publication video is required");
  if (!publication.confirmed_at || !publication.confirmed_by)
    throw new Error("publication must be confirmed before changing privacy");
  if (publication.upload_state !== "uploaded")
    throw new Error("Worker uploaded publication required");
  const scheduled = publication.privacy === "scheduled";
  if (
    scheduled &&
    (!publication.publish_at ||
      !Number.isFinite(Date.parse(publication.publish_at)) ||
      Date.parse(publication.publish_at) <= Date.now())
  )
    throw new Error("Scheduled publish_at must be in the future");
  const privacy = scheduled ? "private" : publication.privacy;
  await context.engine.run(
    "python",
    [
      "-I",
      "-X",
      "utf8",
      "publish/yt.py",
      "privacy",
      publication.youtube_video_id,
      privacy,
      ...(scheduled ? ["--publish-at", publication.publish_at as string] : []),
      "--confirm",
    ],
    { cwd: ENGINE_ROOT },
  );
  await context.db.patchPublication(publication.id, {
    privacy_applied: publication.privacy,
  });
  return { versionStatus: privacyVersionStatus(publication.privacy) };
};
