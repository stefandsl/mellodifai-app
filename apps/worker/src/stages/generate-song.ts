import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
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
export async function refreshBalance(
  context: Pick<
    Parameters<StageHandler>[0],
    "engine" | "db" | "secrets" | "log" | "signal"
  > & { ws: { root: string } },
): Promise<void> {
  try {
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
  } catch (error) {
    try {
      await context.log(
        context.secrets.redact(`Kie balance refresh failed: ${String(error)}`),
      );
    } catch {
      /* Balance telemetry must never fail the generation. */
    }
  }
}
export const generateSong: StageHandler = async (context) => {
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  await writePack(context, pack);
  const lang = language(context);
  const taskFile = join(context.ws.outDir, "task.json");
  const generation = context.version.generation_count ?? 1;
  const marker = join(context.ws.outDir, `submitting-${generation}.json`);
  if ((context.version.kie_generation ?? 1) < generation) {
    const archive = join(
      context.ws.outDir,
      `gen-${context.version.kie_generation ?? 1}`,
    );
    await mkdir(archive, { recursive: true });
    for (const file of await readdir(context.ws.outDir))
      if (
        file === "task.json" ||
        file === "takes.json" ||
        /^(take-|aligned-take|submitting-)/u.test(file)
      ) {
        if (!(await exists(join(archive, file))))
          await rename(join(context.ws.outDir, file), join(archive, file));
      }
    await context.db.patchVersion(context.version.id, {
      kie_task_id: null,
      kie_submit_state: null,
      kie_generation: generation,
    });
    Object.assign(context.version, {
      kie_task_id: null,
      kie_submit_state: null,
      kie_generation: generation,
    });
  }
  let taskId = context.version.kie_task_id ?? null;
  if (taskId) {
    // The durable worker/admin-resolved ID is authoritative. The engine's wait
    // command reads this file, which may be missing after an unknown submission.
    const recovered = join(context.ws.outDir, "task.part.json");
    await writeFile(recovered, JSON.stringify({ taskId }));
    await rename(recovered, taskFile);
  } else if (await exists(taskFile)) {
    const task = JSON.parse(await readFile(taskFile, "utf8")) as {
      taskId?: string;
      id?: string;
    };
    taskId = task.taskId ?? task.id ?? taskId;
  }
  if (
    !taskId &&
    (context.version.kie_submit_state === "submitting" ||
      (await exists(marker)))
  )
    throw new Error("kie submission state unknown, check the kie dashboard");
  if (!taskId && !(await exists(taskFile))) {
    await engine(context, "node", ["tools/kie.mjs", "job", lang]);
    await context.db.patchVersion(context.version.id, {
      kie_submit_state: "submitting",
      kie_generation: generation,
    });
    context.version.kie_submit_state = "submitting";
    await writeFile(
      marker,
      JSON.stringify({ generation, state: "submitting" }),
      { flag: "wx" },
    );
    await engine(context, "node", ["tools/kie.mjs", "generate", lang]);
    const task = JSON.parse(await readFile(taskFile, "utf8")) as {
      taskId?: string;
      id?: string;
    };
    taskId = task.taskId ?? task.id ?? null;
  }
  if (!taskId)
    throw new Error("kie submission state unknown, check the kie dashboard");
  await context.db.patchVersion(context.version.id, {
    kie_task_id: taskId,
    kie_submit_state: "submitted",
    kie_generation: generation,
  });
  Object.assign(context.version, {
    kie_task_id: taskId,
    kie_submit_state: "submitted",
    kie_generation: generation,
  });
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
        generation,
        take_number: take,
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
