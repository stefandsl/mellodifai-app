import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  type LyricPack,
  privacyVersionStatus,
  STAGE_STATUS,
  type Stage,
} from "@mellodifai/shared";
import type { StageContext, StageRegistry, StageResult } from "../loop.js";
import { key, upload, writePack } from "../stages/utils.js";

export const fakePack: LyricPack = {
  title: "A little brighter",
  lyrics: [
    "[Verse 1]",
    ...Array.from({ length: 80 }, (_, i) => `A little brighter, line ${i + 1}`),
  ].join("\n"),
  style: "Bright pop",
  exclude: "",
  settings: {
    model: "V6",
    vocalGender: "f",
    styleWeight: 0.7,
    weirdness: 0.35,
    variety: 1,
    duration: 60,
  },
  displayMap: {},
  l10n: {},
};

// Generated once per registry, in a temporary directory outside the repository.
export async function createFakeMedia(
  context: StageContext,
  tempRoot = "E:\\mellodifai\\tmp",
) {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "fake-media-"));
  const audio = join(root, "take.mp3");
  const video = join(root, "video.mp4");
  const thumbnail = join(root, "thumbnail.png");
  const run = async (args: string[]) => {
    const result = await context.engine.run(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      { cwd: process.cwd() },
    );
    if (result.code !== 0) throw new Error("Fake media generation failed");
  };
  await run([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1000:duration=10",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    audio,
  ]);
  await run([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x3154aa:s=1280x720:r=30:d=10",
    "-i",
    audio,
    "-t",
    "10",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    video,
  ]);
  await run([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x3154aa:s=1280x720",
    "-frames:v",
    "1",
    "-update",
    "1",
    thumbnail,
  ]);
  return { root, audio, video, thumbnail };
}

export function createFakeStages(
  options: {
    tempRoot?: string;
    sleep?: (context: StageContext) => Promise<void>;
  } = {},
): StageRegistry {
  let media: ReturnType<typeof createFakeMedia> | undefined;
  const next: Partial<Record<Stage, Stage>> = {
    timing: "storyboard",
    storyboard: "render_master",
    render_master: "render_hook",
    render_hook: "qa",
    qa: "art",
  };
  const registry: StageRegistry = {};
  const names: Stage[] = [
    "draft_lyrics",
    "generate_song",
    "timing",
    "storyboard",
    "render_master",
    "render_hook",
    "qa",
    "art",
    "publish",
    "set_privacy",
    "stems",
    "visualizer",
    "replace_section",
    "import_audio",
  ];
  for (const stage of names)
    registry[stage] = async (ctx) => {
      await (options.sleep
        ? options.sleep(ctx)
        : setTimeout(1000, undefined, { signal: ctx.signal }));
      ctx.signal.throwIfAborted();
      media ??= createFakeMedia(ctx, options.tempRoot).catch(
        (error: unknown) => {
          media = undefined;
          throw error;
        },
      );
      const fixtures = await media;
      const renderAttempt = ctx.version.render_attempt ?? 1;
      const result: StageResult = { patch: { render_attempt: renderAttempt } };
      const copy = async (source: string, target: string, type: string) => {
        await copyFile(source, target);
        return upload(ctx, target, type);
      };
      switch (stage) {
        case "draft_lyrics":
          await writePack(ctx, fakePack);
          result.patch = { ...result.patch, lyric_pack: fakePack };
          result.versionStatus = "lyrics_review";
          break;
        case "generate_song": {
          await writePack(ctx, fakePack);
          for (const n of [1, 2]) {
            const path = await copy(
              fixtures.audio,
              join(ctx.ws.outDir, `take-${n}.mp3`),
              "audio/mpeg",
            );
            await ctx.db.createTake({
              ...(ctx.version.owner_id
                ? { owner_id: ctx.version.owner_id }
                : {}),
              version_id: ctx.version.id,
              take_number: n,
              generation: ctx.version.generation_count ?? 1,
              kie_task_id: `fake-${ctx.version.id}`,
              audio_preview_path: path,
              // Take 1 reads clearly better, so the studio shows a suggestion in fake mode.
              scores: {
                fidelity: n === 1 ? 0.92 : 0.74,
                duration: 30,
                endDropDb: 30,
                weakSections: [],
                truncated: false,
              },
            });
          }
          result.versionStatus = "takes_review";
          break;
        }
        case "timing": {
          const path = join(
            ctx.ws.publicDir,
            "data",
            ctx.version.lang,
            "timing.json",
          );
          await writeFile(
            path,
            JSON.stringify({
              duration: 10,
              words: [{ start: 0, end: 1, text: "Hello" }],
            }),
          );
          result.patch = {
            ...result.patch,
            timing_path: path,
            qa_flags: [
              { kind: "crushed_words", count: 0 },
              { kind: "timing_duration", value: 10 },
            ],
          };
          result.versionStatus = "producing";
          break;
        }
        case "storyboard": {
          const path = join(
            ctx.ws.publicDir,
            "data",
            ctx.version.lang,
            "storyboard.json",
          );
          await writeFile(path, JSON.stringify({ scenes: [] }));
          result.patch = { ...result.patch, storyboard_path: path };
          break;
        }
        case "render_master":
        case "render_hook": {
          const kind = stage === "render_master" ? "master" : "hook";
          const path = join(
            ctx.ws.renderDir,
            kind === "master" ? "video.mp4" : "hook.mp4",
          );
          await copyFile(fixtures.video, path);
          const preview = await copy(
            fixtures.video,
            join(ctx.ws.renderDir, `${kind}-preview.mp4`),
            "video/mp4",
          );
          await ctx.db.upsertRender({
            ...(ctx.version.owner_id ? { owner_id: ctx.version.owner_id } : {}),
            version_id: ctx.version.id,
            render_attempt: ctx.version.render_attempt ?? 1,
            kind,
            path,
            preview_path: preview,
          });
          await ctx.progress(100);
          break;
        }
        case "qa": {
          const render = await ctx.db.getRender(ctx.version.id, "master");
          if (!render) throw new Error("Fake master is missing");
          await ctx.db.patchRender(render.id, {
            qa_results: {
              gates: [
                "integrated_loudness",
                "true_peak",
                "crushed_words",
                "duration",
              ].map((name) => ({ name, pass: true })),
              informational: [
                {
                  name: "contact_sheet",
                  path: await copy(
                    fixtures.thumbnail,
                    join(ctx.ws.renderDir, "contact-sheet.png"),
                    "image/png",
                  ),
                },
              ],
            },
          });
          break;
        }
        case "art":
          await copy(
            fixtures.thumbnail,
            join(ctx.ws.renderDir, "thumbnail.png"),
            "image/png",
          );
          await writeFile(
            join(ctx.ws.renderDir, `${ctx.version.lang}.srt`),
            "1\n00:00:00,000 --> 00:00:10,000\nA little brighter\n",
          );
          await upload(
            ctx,
            join(ctx.ws.renderDir, `${ctx.version.lang}.srt`),
            "application/x-subrip",
          );
          result.versionStatus = "video_review";
          break;
        case "publish": {
          const render = await ctx.db.getRender(ctx.version.id, "master");
          if (!render) throw new Error("Fake master is missing");
          if (!(await ctx.db.getPublicationForVersion(ctx.version.id)))
            await ctx.db.createPublication({
              ...(ctx.version.owner_id
                ? { owner_id: ctx.version.owner_id }
                : {}),
              render_id: render.id,
              youtube_video_id: "fake-video",
              privacy: "private",
              upload_state: "uploaded",
              privacy_applied: "private",
            });
          result.versionStatus = "approved";
          break;
        }
        case "set_privacy": {
          const publication = await ctx.db.getPublicationForVersion(
            ctx.version.id,
          );
          if (!publication?.confirmed_at || !publication.confirmed_by)
            throw new Error(
              "publication must be confirmed before changing privacy",
            );
          if (
            publication.privacy === "scheduled" &&
            (!publication.publish_at ||
              Date.parse(publication.publish_at) <= Date.now())
          )
            throw new Error("Scheduled publish_at must be in the future");
          if (publication.upload_state !== "uploaded")
            throw new Error("Worker uploaded publication required");
          await ctx.db.patchPublication(publication.id, {
            privacy_applied: publication.privacy,
          });
          result.versionStatus = privacyVersionStatus(publication.privacy);
          break;
        }
        case "stems": {
          // The fake tone stands in for every stem; same shape as stages/stems.ts writes.
          const takeId =
            ((ctx.job.payload ?? {}) as { take_id?: string }).take_id ??
            ctx.version.chosen_take_id;
          if (!takeId) throw new Error("Fake stems need a chosen take");
          const tracks: Record<string, { path: string; peaks: number[] }> = {};
          for (const name of ["vocals", "drums", "bass", "other"])
            tracks[name] = {
              path: await copy(
                fixtures.audio,
                join(ctx.ws.outDir, `stems-${takeId}-${name}.mp3`),
                "audio/mpeg",
              ),
              peaks: Array.from({ length: 600 }, () => 0.5),
            };
          await ctx.db.patchTake(takeId, {
            stems: {
              model: "htdemucs",
              format: "mp3",
              bitrate: 192,
              duration: 10,
              seconds: 1,
              created_at: new Date().toISOString(),
              tracks,
            },
          });
          return {};
        }
        case "visualizer": {
          // The fixture video stands in for the render, under the names stages/visualizer.ts uses.
          const renderId = ((ctx.job.payload ?? {}) as { render_id?: string })
            .render_id;
          const render = renderId ? await ctx.db.getRenderById(renderId) : null;
          if (!render?.aspect)
            throw new Error("Fake visualizer needs its render");
          const name = `visualizer-${render.aspect.replace(":", "x")}`;
          const preview = await copy(
            fixtures.video,
            join(ctx.ws.renderDir, `${name}.mp4`),
            "video/mp4",
          );
          await copy(
            fixtures.thumbnail,
            join(ctx.ws.renderDir, `${name}.jpg`),
            "image/jpeg",
          );
          await ctx.db.patchRender(render.id, {
            path: join(ctx.ws.renderDir, `${name}.mp4`),
            preview_path: preview,
          });
          await ctx.progress(100, "Video pronto");
          return {};
        }
        case "replace_section": {
          // The fake tone stands in for both alternatives, as stages/replace-section.ts stores them.
          const editId = ((ctx.job.payload ?? {}) as { edit_id?: string })
            .edit_id;
          const edit = editId ? await ctx.db.getSectionEdit(editId) : null;
          if (!edit) throw new Error("Fake rewrite needs its request");
          const alternatives = [];
          for (const n of [1, 2])
            alternatives.push({
              path: await copy(
                fixtures.audio,
                join(ctx.ws.outDir, `section-${edit.id.slice(0, 8)}-${n}.mp3`),
                "audio/mpeg",
              ),
              duration: 10,
            });
          await ctx.db.patchSectionEdit(edit.id, { alternatives });
          await ctx.progress(100, "Alternative pronte");
          return {};
        }
        case "import_audio": {
          const take = await ctx.db.createTake({
            ...(ctx.version.owner_id ? { owner_id: ctx.version.owner_id } : {}),
            version_id: ctx.version.id,
            generation: ctx.version.generation_count ?? 1,
            take_number: 1,
            engine: "import",
            audio_preview_path: await copy(
              fixtures.audio,
              join(ctx.ws.outDir, "take-1-preview.mp3"),
              "audio/mpeg",
            ),
            source: { kind: "import" },
          });
          return {
            versionStatus: "audio_ready",
            patch: { chosen_take_id: take.id },
          };
        }
      }
      const following = next[stage];
      const status = STAGE_STATUS[stage];
      if (status) result.versionStatus = status;
      if (following)
        result.enqueue = [
          {
            stage: following,
            idempotencyKey: key(following, {
              ...ctx,
              version: { ...ctx.version, render_attempt: renderAttempt },
            }),
          },
        ];
      return result;
    };
  return registry;
}
export const fakeStages = createFakeStages();
