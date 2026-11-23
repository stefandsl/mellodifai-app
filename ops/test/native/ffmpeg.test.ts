import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { expect, it, vi } from "vitest";
import { installPinnedFfmpeg } from "../../install-ffmpeg.js";
import { loadManifest } from "../../lib/native/artifacts.js";
import { fixture } from "./fixtures.js";

/** Multi-file stored ZIP fixture matching GyanD essentials archive layout. */
function zipFiles(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const data = Buffer.from(text);
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);

    offset += local.length + filename.length + data.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const count = Object.keys(entries).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function mutateOneByte(hex: string): string {
  const digest = Buffer.from(hex, "hex");
  const last = digest.length - 1;
  digest[last] = (digest[last] ?? 0) ^ 0x01;
  return digest.toString("hex");
}

const sampleArchive = zipFiles({
  "ffmpeg-9.1-essentials_build/bin/ffmpeg.exe": "fake-ffmpeg-binary",
  "ffmpeg-9.1-essentials_build/bin/ffprobe.exe": "fake-ffprobe-binary",
  "ffmpeg-9.1-essentials_build/LICENSE": "GNU GENERAL PUBLIC LICENSE Version 3",
  "ffmpeg-9.1-essentials_build/doc/ffmpeg.html": "<html>doc</html>",
});
const sampleHash = createHash("sha256").update(sampleArchive).digest("hex");

it("pins a fixed-version Windows x64 FFmpeg build in manifest.json", () => {
  const manifest = loadManifest();
  const ffmpeg = manifest.artifacts.ffmpeg;
  const win = ffmpeg?.downloads["win32-x64"];
  expect(ffmpeg?.kind).toBe("binary");
  expect(ffmpeg?.licence).toBe("GPL-3.0");
  expect(ffmpeg?.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
  expect(ffmpeg?.entry["win32-x64"]).toBe("bin/ffmpeg.exe");
  expect(win?.url).toMatch(
    /^https:\/\/github\.com\/GyanD\/codexffmpeg\/releases\/download\/[\d.]+\/ffmpeg-[\d.]+-essentials_build\.zip$/,
  );
  expect(win?.url.toLowerCase()).not.toContain("latest");
  expect(win?.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(Number.isSafeInteger(win?.size) && (win?.size ?? 0) > 0).toBe(true);
  expect(win?.strip).toBe(1);
  expect(win?.include).toEqual(["bin/", "LICENSE"]);
  expect(win?.notices).toEqual(["LICENSE"]);
});

it("installs the pinned FFmpeg archive and returns its bin folder", async () => {
  const root = fixture();
  const manifest = structuredClone(loadManifest());
  const win = manifest.artifacts.ffmpeg?.downloads["win32-x64"];
  if (!win) throw new Error("Missing ffmpeg win32-x64 download entry");
  win.sha256 = sampleHash;
  win.size = sampleArchive.length;

  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(new Uint8Array(sampleArchive)));
  const binDir = await installPinnedFfmpeg({
    manifest,
    platform: "win32-x64",
    cache: root,
    seedDirs: [],
    fetchImpl,
  });

  expect(existsSync(join(binDir, "ffmpeg.exe"))).toBe(true);
  expect(existsSync(join(binDir, "ffprobe.exe"))).toBe(true);
  expect(existsSync(join(binDir, "..", "LICENSE"))).toBe(true);
  expect(existsSync(join(binDir, "..", "doc", "ffmpeg.html"))).toBe(false);
  expect(
    await installPinnedFfmpeg({
      manifest,
      platform: "win32-x64",
      cache: root,
      seedDirs: [],
      fetchImpl,
    }),
  ).toBe(binDir);
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it("refuses when one byte of the pinned FFmpeg hash is changed", async () => {
  const root = fixture();
  const manifest = structuredClone(loadManifest());
  const ffmpeg = manifest.artifacts.ffmpeg;
  const win = ffmpeg?.downloads["win32-x64"];
  if (!ffmpeg || !win) throw new Error("Missing ffmpeg win32-x64 entry");
  win.sha256 = mutateOneByte(sampleHash);
  win.size = sampleArchive.length;

  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(new Uint8Array(sampleArchive)));
  await expect(
    installPinnedFfmpeg({
      manifest,
      platform: "win32-x64",
      cache: root,
      seedDirs: [],
      fetchImpl,
    }),
  ).rejects.toThrow("Checksum mismatch");

  expect(readdirSync(join(root, "downloads"))).toEqual([]);
  expect(existsSync(join(root, "ffmpeg", ffmpeg.version, "win32-x64"))).toBe(
    false,
  );
});

it("refuses when the downloaded FFmpeg archive size does not match", async () => {
  const root = fixture();
  const manifest = structuredClone(loadManifest());
  const ffmpeg = manifest.artifacts.ffmpeg;
  const win = ffmpeg?.downloads["win32-x64"];
  if (!ffmpeg || !win) throw new Error("Missing ffmpeg win32-x64 entry");
  win.sha256 = sampleHash;
  win.size = sampleArchive.length + 1;

  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(new Uint8Array(sampleArchive)));
  await expect(
    installPinnedFfmpeg({
      manifest,
      platform: "win32-x64",
      cache: root,
      seedDirs: [],
      fetchImpl,
    }),
  ).rejects.toThrow("Checksum mismatch");

  expect(readdirSync(join(root, "downloads"))).toEqual([]);
  expect(existsSync(join(root, "ffmpeg", ffmpeg.version, "win32-x64"))).toBe(
    false,
  );
});
