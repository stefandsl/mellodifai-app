import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type InstallOptions,
  installArtifact,
  requireArtifact,
  seedDirsFromEnv,
} from "./lib/native/artifacts.js";

/** Download, verify against manifest.json, and extract the pinned FFmpeg binary.
 * Returns the directory containing the FFmpeg executable so callers (including CI)
 * can put it on PATH.
 */
export async function installPinnedFfmpeg(
  options: InstallOptions = {},
): Promise<string> {
  await installArtifact("ffmpeg", options);
  const installed = requireArtifact("ffmpeg", options);
  if (!existsSync(installed.entry))
    throw new Error(
      `Pinned FFmpeg executable missing after install: ${installed.entry}`,
    );
  return dirname(installed.entry);
}

async function main(): Promise<void> {
  const binDir = await installPinnedFfmpeg({
    seedDirs: seedDirsFromEnv(),
    log: (message) => process.stderr.write(`${message}\n`),
  });
  process.stdout.write(`${binDir}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "FFmpeg installation failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
