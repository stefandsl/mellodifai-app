import { expect, it, vi } from "vitest";
import { transcodePreview } from "../src/preview.js";

it("encodes 480p H.264/AAC previews and raises CRF until at most 15 MB", async () => {
  const run = vi.fn(async () => ({ code: 0 }));
  const size = vi
    .fn()
    .mockResolvedValueOnce(16 * 1024 * 1024)
    .mockResolvedValue(14 * 1024 * 1024);
  await transcodePreview(
    { run },
    "source.mp4",
    "E:\\mellodifai\\tmp\\preview.mp4",
    size,
  );
  expect(run.mock.calls).toHaveLength(2);
  expect(run).toHaveBeenNthCalledWith(
    1,
    "ffmpeg",
    [
      "-y",
      "-i",
      "source.mp4",
      "-vf",
      "scale=-2:480",
      "-c:v",
      "libx264",
      "-crf",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      "E:\\mellodifai\\tmp\\preview.mp4",
    ],
    expect.anything(),
  );
  expect(run).toHaveBeenNthCalledWith(
    2,
    "ffmpeg",
    expect.arrayContaining(["-crf", "32"]),
    expect.anything(),
  );
});
it("rejects previews still oversized at the final CRF", async () => {
  await expect(
    transcodePreview(
      { run: vi.fn(async () => ({ code: 0 })) },
      "source",
      "output",
      async () => 16 * 1024 * 1024,
    ),
  ).rejects.toThrow("15 MB");
});
