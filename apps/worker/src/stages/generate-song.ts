import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LyricPackSchema } from "@mellodifai/shared";
import type { StageHandler } from "../loop.js";
import {
  ENGINE_ROOT,
  engine,
  key,
  language,
  upload,
  writePack,
} from "./utils.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function refreshBalance(
  context: Parameters<StageHandler>[0],
): Promise<void> {
  let output = "";
  const original = context.log;
  const balanceEngine = context.engine.withWorkspace(
    context.ws.root,
    async (line) => {
      output += `${line}\n`;
      await original(line);
    },
    context.signal,
  );
  await balanceEngine.run("node", ["tools/kie.mjs", "credit"], {
    cwd: ENGINE_ROOT,
  });
  const values = output.match(/\d+(?:\.\d+)?/gu);
  const value = values?.at(-1);
  if (value)
    await context.db.upsertWorker({
      id:
        context.secrets.values.WORKER_ID ??
        `worker-${process.env.COMPUTERNAME ?? "pc"}`,
      kie_balance: Number(value),
    });
}
export const generateSong: StageHandler = async (context) => {
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  await writePack(context, pack);
  const lang = language(context);
  const taskFile = join(context.ws.outDir, "task.json");
  let taskId = context.version.kie_task_id ?? null;
  if (!taskId && !(await exists(taskFile))) {
    await engine(context, "node", ["tools/kie.mjs", "job", lang]);
    await engine(context, "node", ["tools/kie.mjs", "generate", lang]);
    try {
      const task = JSON.parse(await readFile(taskFile, "utf8")) as {
        taskId?: string;
        id?: string;
      };
      taskId = task.taskId ?? task.id ?? null;
    } catch {}
  }
  await context.engine.run("node", ["tools/kie.mjs", "wait", lang], {
    cwd: ENGINE_ROOT,
  });
  for (const take of [1, 2])
    await context.engine.run(
      "node",
      ["tools/kie.mjs", "lyrics-ts", lang, String(take)],
      { cwd: ENGINE_ROOT },
    );
  const takes = [];
  for (const take of [1, 2]) {
    const source = join(context.ws.outDir, `take-${take}.mp3`);
    const preview = join(context.ws.outDir, `take-${take}-preview.mp3`);
    await context.engine.run(
      "ffmpeg",
      ["-y", "-i", source, "-b:a", "128k", "-f", "mp3", preview],
      { cwd: ENGINE_ROOT, outputs: [preview] },
    );
    takes.push(
      await context.db.createTake({
        ...(context.version.owner_id
          ? { owner_id: context.version.owner_id }
          : {}),
        version_id: context.version.id,
        kie_task_id: taskId,
        audio_preview_path: await upload(context, preview, "audio/mpeg"),
      }),
    );
  }
  await refreshBalance(context);
  await context.log(`Generated ${takes.length} takes`);
  return {
    versionStatus: "takes_review",
    patch: {
      kie_task_id: taskId,
      render_attempt: context.version.render_attempt ?? 1,
    },
    enqueue: [],
  };
};
export const generateSongIdempotencyKey = key;
