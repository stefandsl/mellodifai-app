import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  LyricPackSchema,
  readControls,
  withMusicTags,
} from "@mellodifai/shared";
import { assertKieAllowed } from "../kie/guard.js";
import type { StageContext, StageHandler } from "../loop.js";
import { generateLocal, songEngine } from "./local-engine.js";
import { scoreTakes } from "./score-takes.js";
import { songSource, submitSourceTask } from "./source-audio.js";
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
// Suno's artwork per take, as kie returned it in record.json (data.response.data[].image_url).
export async function sunoCoverUrls(outDir: string): Promise<string[]> {
  try {
    const record = JSON.parse(
      await readFile(join(outDir, "record.json"), "utf8"),
    ) as { data?: { response?: { data?: { image_url?: unknown }[] } } };
    return (record.data?.response?.data ?? []).map((item) =>
      typeof item.image_url === "string" ? item.image_url : "",
    );
  } catch {
    return [];
  }
}

// Suno's track ids per take, as kie.mjs wait saved them in takes.json (the replace-section input).
export async function kieTrackIds(outDir: string): Promise<(string | null)[]> {
  try {
    const tracks = JSON.parse(
      await readFile(join(outDir, "takes.json"), "utf8"),
    ) as { id?: unknown }[];
    return tracks.map((track) =>
      typeof track.id === "string" ? track.id : null,
    );
  } catch {
    return [];
  }
}

// Downloads one cover and uploads it next to the previews. A cover is a nicety: any failure
// is logged and the take keeps no cover, never failing the song.
async function saveCover(
  context: StageContext,
  url: string | undefined,
  generation: number,
  take: number,
): Promise<string | null> {
  if (!url?.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: context.signal });
    if (!response.ok) throw new Error(`cover download ${response.status}`);
    const file = join(context.ws.outDir, `cover-${generation}-${take}.jpg`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    return await upload(context, file, "image/jpeg");
  } catch (error) {
    await context.log(
      context.secrets.redact(
        `Cover not saved for take ${take}: ${String(error)}`,
      ),
    );
    return null;
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
    // kie.mjs prints one JSON line: {"credits":N,"usd":..,"generate_calls_affordable":..}.
    const value = output
      .split("\n")
      .map((line) => {
        try {
          return (JSON.parse(line) as { credits?: unknown }).credits;
        } catch {
          return undefined;
        }
      })
      .filter((credits): credits is number => typeof credits === "number")
      .at(-1);
    if (value !== undefined)
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
  // Local engines branch off before any kie state is read or written (design 5.1).
  const songEngineId = songEngine(context.project.song_settings);
  if (songEngineId !== "kie") return generateLocal(context, songEngineId);
  // Paid from here on: never for a test account or a test song.
  await assertKieAllowed(context);
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  // The chosen tempo, key and time signature reach kie as style tags; the stored pack keeps the
  // style as drafted.
  await writePack(context, {
    ...pack,
    style: withMusicTags(
      pack.style,
      readControls(context.project.song_settings),
    ),
  });
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
      kie_task_state: null,
      kie_submit_state: null,
      kie_generation: generation,
    });
    Object.assign(context.version, {
      kie_task_id: null,
      kie_task_state: null,
      kie_submit_state: null,
      kie_generation: generation,
    });
  }
  let taskId = context.version.kie_task_id ?? null;
  if (context.version.kie_task_state === "failed")
    throw new Error("kie task failed; create a new generation to try again");
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
    let stderr = "";
    const source = songSource(context.project.song_settings);
    // A cover, reference or extension starts from audio: kie's upload endpoints instead of
    // `kie.mjs generate`, the same task.json and the same two outcomes on a failure.
    const submit = source
      ? await submitSourceTask(context, source, {
          ...pack,
          style: withMusicTags(
            pack.style,
            readControls(context.project.song_settings),
          ),
        }).then(
          () => ({ code: 0 }),
          (error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            stderr = message;
            return { code: /not charged/u.test(message) ? 4 : 1 };
          },
        )
      : await context.engine.run("node", ["tools/kie.mjs", "generate", lang], {
          cwd: ENGINE_ROOT,
          allowNonZero: true,
          onStderr: (line) => {
            stderr += `${line}\n`;
          },
        });
    if (submit.code !== 0) {
      const refused =
        submit.code === 4 ||
        /HTTP [^\r\n]*\/api\/v1\/(?:chat\/credit|jobs\/createTask)(?=[:\s])/u.test(
          stderr,
        );
      if (!refused)
        throw new Error(
          "kie submission state unknown, check the kie dashboard",
        );
      await context.db.patchVersion(context.version.id, {
        kie_submit_state: null,
      });
      context.version.kie_submit_state = null;
      await rm(marker, { force: true });
      throw new Error(
        "kie submission was not charged; correct the issue and generate again",
      );
    }
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
  let waitError = "";
  const waited = await context.engine.run(
    "node",
    ["tools/kie.mjs", "wait", lang],
    {
      cwd: ENGINE_ROOT,
      allowNonZero: true,
      onStderr: (line) => {
        waitError += `${line}\n`;
      },
    },
  );
  if (waited.code === 2) {
    await context.db.patchVersion(context.version.id, {
      kie_task_state: "failed",
    });
    context.version.kie_task_state = "failed";
    throw new Error(
      context.secrets
        .redact(waitError.trim() || "kie task failed")
        .slice(0, 300),
    );
  }
  if (waited.code !== 0)
    throw new Error("kie task still pending: Retry checks again for free");
  // Word timestamps of a song made from audio are a nicety: kie may not align them.
  const fromAudio = songSource(context.project.song_settings) !== null;
  for (const take of [1, 2])
    await context.engine.run(
      "node",
      ["tools/kie.mjs", "lyrics-ts", lang, String(take)],
      { cwd: ENGINE_ROOT, ...(fromAudio ? { allowNonZero: true } : {}) },
    );
  const covers = await sunoCoverUrls(context.ws.outDir);
  const audioIds = await kieTrackIds(context.ws.outDir);
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
        ...(audioIds[take - 1] ? { kie_audio_id: audioIds[take - 1] } : {}),
        audio_preview_path: await upload(context, preview, "audio/mpeg"),
        engine: "kie",
        cover_path: await saveCover(
          context,
          covers[take - 1],
          generation,
          take,
        ),
      }),
    );
  }
  await refreshBalance(context);
  await scoreTakes(context, takes);
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
