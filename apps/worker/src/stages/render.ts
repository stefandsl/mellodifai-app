import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StageHandler } from "../loop.js";
import { ENGINE_ROOT, key, language, upload } from "./utils.js";

async function preview(
  context: Parameters<StageHandler>[0],
  source: string,
  name: string,
): Promise<string> {
  const output = join(context.ws.renderDir, name);
  let crf = 30;
  let size = Number.POSITIVE_INFINITY;
  do {
    await context.engine.run(
      "ffmpeg",
      [
        "-y",
        "-i",
        source,
        "-vf",
        "scale=-2:480",
        "-c:v",
        "libx264",
        "-crf",
        String(crf),
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        output,
      ],
      { cwd: ENGINE_ROOT, outputs: [output] },
    );
    let probeOutput = "";
    const probe = context.engine.withWorkspace(
      context.ws.root,
      async (line) => {
        probeOutput += line;
      },
      context.signal,
    );
    const result = await probe.run(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=size",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        output,
      ],
      { cwd: ENGINE_ROOT },
    );
    size = Number(probeOutput.trim());
    if (result.code !== 0 || !Number.isFinite(size) || size <= 0)
      throw new Error("Cannot determine preview size");
    crf += 2;
  } while (size > 15 * 1024 * 1024 && crf <= 42);
  if (size > 15 * 1024 * 1024) throw new Error("preview exceeds 15 MB");
  return upload(context, output, "video/mp4");
}
function handler(kind: "master" | "hook"): StageHandler {
  return async (context) => {
    const lang = language(context);
    const output = join(
      context.ws.renderDir,
      kind === "master" ? "video.mp4" : "hook.mp4",
    );
    const props = join(context.ws.root, "fps30.json");
    await writeFile(props, '{"fps":30}');
    let rendered = 0;
    const run = context.engine.withWorkspace(
      context.ws.root,
      async (line) => {
        await context.log(line);
        const match = /Rendered\s+(\d+)\/(\d+)/u.exec(line);
        if (match?.[1] && match[2]) {
          const percent = Math.round(
            (Number(match[1]) / Number(match[2])) * 100,
          );
          if (percent > rendered) {
            rendered = percent;
            await context.progress(percent);
          }
        }
      },
      context.signal,
    );
    await run.run(
      "node",
      [
        "scripts/r.mjs",
        "render",
        `${kind === "master" ? "Video" : "Hook"}-${lang}`,
        output,
        `--props=${props}`,
        "--gl=angle",
        "--log=error",
      ],
      { cwd: join(ENGINE_ROOT, "motion"), outputs: [output] },
    );
    const previewPath = await preview(context, output, `${kind}-preview.mp4`);
    await context.db.upsertRender({
      ...(context.version.owner_id
        ? { owner_id: context.version.owner_id }
        : {}),
      version_id: context.version.id,
      render_attempt: context.version.render_attempt ?? 1,
      kind,
      path: output,
      preview_path: previewPath,
    });
    return kind === "master"
      ? {
          enqueue: [
            {
              stage: "render_hook",
              idempotencyKey: key("render_hook", context),
            },
          ],
        }
      : { enqueue: [{ stage: "qa", idempotencyKey: key("qa", context) }] };
  };
}
export const renderMaster = handler("master");
export const renderHook = handler("hook");
