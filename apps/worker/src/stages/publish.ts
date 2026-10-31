import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LyricPackSchema } from "@mellodifai/shared";
import type { StageHandler } from "../loop.js";
import { ENGINE_ROOT, language } from "./utils.js";

function pacificDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export const publish: StageHandler = async (context) => {
  const workerId =
    context.secrets.values.WORKER_ID ??
    `worker-${process.env.COMPUTERNAME ?? "pc"}`;
  const worker = await context.db.getWorker(workerId);
  const day = pacificDay();
  const used =
    worker?.youtube_quota_day === day ? (worker.youtube_uploads_today ?? 0) : 0;
  if (used >= 4)
    return {
      retryLater:
        "YouTube daily upload quota reached; retry after Pacific midnight",
    };
  const render = await context.db.getRender(context.version.id, "master");
  if (!render?.path)
    throw new Error("master render is required before publishing");
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  const meta = {
    video: render.path,
    captions: join(context.ws.renderDir, `${language(context)}.srt`),
    captions_name: pack.title,
    thumbnail: join(context.ws.renderDir, "thumbnail.png"),
    title: pack.title,
    description: context.project.brief ?? "",
    tags: [],
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
  await runner.run(
    "python",
    ["-I", "-X", "utf8", "publish/yt.py", "upload", file],
    { cwd: ENGINE_ROOT },
  );
  const videoId = /video id\s+([\w-]+)/iu.exec(output)?.[1];
  if (!videoId) throw new Error("YouTube upload did not return a video id");
  await context.db.createPublication({
    ...(context.version.owner_id ? { owner_id: context.version.owner_id } : {}),
    render_id: render.id,
    youtube_video_id: videoId,
    privacy: "private",
    metadata: meta,
  });
  await context.db.upsertWorker({
    id: workerId,
    youtube_quota_day: day,
    youtube_uploads_today: used + 1,
  });
  return { versionStatus: "publishing" };
};
export const setPrivacy: StageHandler = async (context) => {
  const publication = await context.db.getPublicationForVersion(
    context.version.id,
  );
  if (!publication?.youtube_video_id)
    throw new Error("publication video is required");
  if (!publication.confirmed_at || !publication.confirmed_by)
    throw new Error("publication must be confirmed before changing privacy");
  const privacy =
    publication.privacy === "scheduled" ? "public" : publication.privacy;
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
      "--confirm",
    ],
    { cwd: ENGINE_ROOT },
  );
  return { versionStatus: "published" };
};
