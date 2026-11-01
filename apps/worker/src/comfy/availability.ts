import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Lang, LocalSongEngine } from "@mellodifai/shared";
import type { Db } from "../db.js";
import {
  COMFY_CONFIG,
  type ComfyConfig,
  LOCAL_ENGINES,
  type LocalEngineSpec,
} from "./config.js";

// What workers.engines holds per engine; the studio lists an engine only when it is installed
// and every chosen language passed its bake-off.
export type EngineAvailability = {
  installed: boolean;
  passedLangs: Lang[];
  minutesPerAudioMinute: number;
  checkedAt: string;
};

async function size(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

// The pinned runtime is on disk: the embedded Python, ComfyUI and the version it was tested at.
async function runtimeInstalled(config: ComfyConfig): Promise<boolean> {
  if ((await size(join(config.root, "python_embeded", "python.exe"))) === null)
    return false;
  if ((await size(join(config.root, "ComfyUI", "main.py"))) === null)
    return false;
  try {
    const version = await readFile(
      join(config.root, "ComfyUI", "comfyui_version.py"),
      "utf8",
    );
    return version.includes(`__version__ = "${config.version}"`);
  } catch {
    return false;
  }
}

// File checks only: ComfyUI is never started to answer this, so the GPU stays free.
export async function checkEngines(
  config: ComfyConfig = COMFY_CONFIG,
  engines: Record<LocalSongEngine, LocalEngineSpec> = LOCAL_ENGINES,
  now: Date = new Date(),
): Promise<Record<LocalSongEngine, EngineAvailability>> {
  const runtime = await runtimeInstalled(config);
  const entries = await Promise.all(
    (Object.entries(engines) as [LocalSongEngine, LocalEngineSpec][]).map(
      async ([id, spec]) => {
        const sizes = await Promise.all(
          spec.files.map((file) =>
            size(join(config.root, "ComfyUI", "models", file.path)),
          ),
        );
        const installed =
          runtime && spec.files.every((file, i) => sizes[i] === file.bytes);
        return [
          id,
          {
            installed,
            passedLangs: [...spec.passedLangs],
            minutesPerAudioMinute: spec.minutesPerAudioMinute,
            checkedAt: now.toISOString(),
          },
        ] as const;
      },
    ),
  );
  return Object.fromEntries(entries) as Record<
    LocalSongEngine,
    EngineAvailability
  >;
}

export async function publishEngines(
  db: Pick<Db, "upsertWorker">,
  workerId: string,
  check: () => Promise<Record<string, EngineAvailability>> = () =>
    checkEngines(),
): Promise<void> {
  await db.upsertWorker({ id: workerId, engines: await check() });
}
