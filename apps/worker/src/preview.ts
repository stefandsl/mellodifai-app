import { stat } from "node:fs/promises";
import type { Engine } from "./engine.js";

export async function transcodePreview(
  engine: Pick<Engine, "run">,
  source: string,
  output: string,
  size: (path: string) => Promise<number> = async (path) =>
    (await stat(path)).size,
): Promise<void> {
  for (let crf = 30; crf <= 42; crf += 2) {
    await engine.run(
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
      { outputs: [output] },
    );
    const bytes = await size(output);
    if (!Number.isFinite(bytes) || bytes <= 0)
      throw new Error("Cannot determine preview size");
    if (bytes <= 15 * 1024 * 1024) return;
  }
  throw new Error("preview exceeds 15 MB");
}
