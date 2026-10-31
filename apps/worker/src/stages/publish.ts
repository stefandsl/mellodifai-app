import { mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { LyricPackSchema, privacyVersionStatus } from "@mellodifai/shared";
import type { StageHandler } from "../loop.js";
import { nextPacificQuotaTime } from "./quota.js";
import { ENGINE_ROOT, language } from "./utils.js";

export const publish: StageHandler = async (context) => {
  const workerId =
    context.secrets.values.WORKER_ID ??
    `worker-${process.env.COMPUTERNAME ?? "pc"}`;
  const render = await context.db.getRender(context.version.id, "master");
  if (!render?.path)
    throw new Error("master render is required before publishing");
  const prior = await context.db.getPublicationForVersion(context.version.id);
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
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  const requested = context.job.payload?.metadata as
    | { title?: string; description?: string; tags?: string; chapters?: string }
    | undefined;
  const meta = {
    video: render.path,
    captions: join(context.ws.renderDir, `${language(context)}.srt`),
    captions_name: pack.title,
    thumbnail: join(context.ws.renderDir, "thumbnail.png"),
    title: requested?.title ?? pack.title,
    description: [
      requested?.description ?? context.project.brief ?? "",
      requested?.chapters ?? "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    tags:
      requested?.tags
        ?.split(",")
        .map((tag) => tag.trim())
        .filter(Boolean) ?? [],
    categoryId: "10",
    defaultLanguage: language(context),
    defaultAudioLanguage: language(context),
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
  const result = await runner.run(
    "python",
    ["-I", "-X", "utf8", "publish/yt.py", "upload", file],
    { cwd: ENGINE_ROOT, allowNonZero: true },
  );
  const videoId = /video id\s+([\w-]+)/iu.exec(output)?.[1];
  if (result.code !== 0 && !videoId) {
    await context.db.releaseUpload(
      reservation.publication.id,
      workerId,
      "YouTube upload failed before a video id was returned",
    );
    throw new Error("YouTube upload failed before a video id was returned");
  }
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
