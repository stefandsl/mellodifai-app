import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  type ArtifactDownload,
  obtainArchive,
} from "../../lib/native/artifacts.js";
import { fixture, zip } from "./fixtures.js";

const bytes = zip("file", "verified bytes");
const expected: ArtifactDownload = {
  url: "https://example.invalid/pinned.zip",
  file: "pinned.zip",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size: bytes.length,
  strip: 0,
  notices: ["LICENSE"],
};
it("accepts the pinned checksum and reuses the verified archive", async () => {
  const root = fixture();
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(new Uint8Array(bytes)));
  const path = await obtainArchive(expected, root, { fetchImpl });
  expect(readFileSync(path)).toEqual(bytes);
  expect(await obtainArchive(expected, root, { fetchImpl })).toBe(path);
  expect(fetchImpl).toHaveBeenCalledOnce();
});
it("refuses tampered bytes of the right size and leaves no complete archive", async () => {
  const root = fixture();
  const bad = Buffer.from(bytes);
  bad[40] = (bad[40] ?? 0) ^ 1;
  await expect(
    obtainArchive(expected, root, {
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(bad)),
    }),
  ).rejects.toThrow("Checksum mismatch");
  expect(readdirSync(join(root, "downloads"))).toEqual([]);
});
it("uses a matching seed before any download", async () => {
  const root = fixture();
  const seed = join(root, "seed");
  mkdirSync(seed);
  writeFileSync(join(seed, "different-name.zip"), bytes);
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("Network forbidden"));
  expect(
    readFileSync(
      await obtainArchive(expected, root, { seedDirs: [seed], fetchImpl }),
    ),
  ).toEqual(bytes);
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("discards interrupted downloads and retries with complete bytes", async () => {
  const root = fixture();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 20));
    },
    pull(controller) {
      controller.error(new Error("interrupted"));
    },
  });
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(stream))
    .mockResolvedValueOnce(new Response(new Uint8Array(bytes)));
  await expect(obtainArchive(expected, root, { fetchImpl })).rejects.toThrow(
    "interrupted",
  );
  expect(readdirSync(join(root, "downloads"))).toEqual([]);
  expect(
    readFileSync(await obtainArchive(expected, root, { fetchImpl })),
  ).toEqual(bytes);
});
