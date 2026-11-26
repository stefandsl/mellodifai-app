import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  type ArtifactDownload,
  installArtifact,
  loadManifest,
  type Manifest,
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
it("pins ffmpeg for win32-x64 from GyanD/codexffmpeg with its bin folder and licence", () => {
  const manifest = loadManifest();
  const ffmpeg = manifest.artifacts.ffmpeg;
  const win = ffmpeg?.downloads["win32-x64"];
  expect(ffmpeg?.kind).toBe("binary");
  expect(ffmpeg?.licence).toBe("GPL-3.0");
  expect(ffmpeg?.entry["win32-x64"]).toBe("bin/ffmpeg.exe");
  expect(win?.url).toMatch(
    /^https:\/\/github\.com\/GyanD\/codexffmpeg\/releases\/download\/[\d.]+\/ffmpeg-[\d.]+-essentials_build\.zip$/,
  );
  expect(win?.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(win?.strip).toBe(1);
  expect(win?.include).toEqual(["bin/", "LICENSE"]);
  expect(win?.notices).toEqual(["LICENSE"]);
});

const installManifest: Manifest = {
  schema: 1,
  artifacts: {
    tool: {
      version: "1.0.0",
      kind: "binary",
      licence: "MIT",
      project: "test-tool",
      entry: { "win32-x64": "file" },
      downloads: {
        "win32-x64": {
          ...expected,
          notices: ["file"],
        },
      },
    },
  },
};

function renameError(
  code: string,
  from: string,
  to: string,
): NodeJS.ErrnoException {
  return Object.assign(
    new Error(`${code}: operation not permitted, rename '${from}' -> '${to}'`),
    { code, syscall: "rename", path: from, dest: to },
  );
}

it("retries the staging folder rename on EPERM and succeeds once unlocked", async () => {
  const root = fixture();
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(new Uint8Array(bytes)));
  const waits: number[] = [];
  let failures = 0;
  const renameImpl = vi.fn((from: string, to: string) => {
    if (failures < 2) {
      failures++;
      throw renameError("EPERM", from, to);
    }
    renameSync(from, to);
  });

  const target = await installArtifact("tool", {
    manifest: installManifest,
    platform: "win32-x64",
    cache: root,
    fetchImpl,
    renameImpl,
    sleepImpl: async (ms) => {
      waits.push(ms);
    },
  });

  expect(readFileSync(join(target, "file"), "utf8")).toBe("verified bytes");
  expect(renameImpl).toHaveBeenCalledTimes(3);
  expect(waits).toEqual([100, 200]);
});

it("retries both the stale-target move and the staging rename on EBUSY and EACCES", async () => {
  const root = fixture();
  const staleTarget = join(root, "tool", "1.0.0", "win32-x64");
  mkdirSync(staleTarget, { recursive: true });
  writeFileSync(join(staleTarget, "stale"), "old");

  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(new Uint8Array(bytes)));
  const waits: number[] = [];
  let failedOld = false;
  let failedStaging = false;
  const renameImpl = vi.fn((from: string, to: string) => {
    if (from === staleTarget && !failedOld) {
      failedOld = true;
      throw renameError("EBUSY", from, to);
    }
    if (to === staleTarget && !failedStaging) {
      failedStaging = true;
      throw renameError("EACCES", from, to);
    }
    renameSync(from, to);
  });

  const target = await installArtifact("tool", {
    manifest: installManifest,
    platform: "win32-x64",
    cache: root,
    fetchImpl,
    renameImpl,
    sleepImpl: async (ms) => {
      waits.push(ms);
    },
  });

  expect(target).toBe(staleTarget);
  expect(readFileSync(join(target, "file"), "utf8")).toBe("verified bytes");
  expect(existsSync(join(target, "stale"))).toBe(false);
  expect(renameImpl).toHaveBeenCalledTimes(4);
  expect(waits).toEqual([100, 100]);
});

it("throws the original error naming the path after reaching the rename retry cap", async () => {
  const root = fixture();
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(new Uint8Array(bytes)));
  const waits: number[] = [];
  let lastError: NodeJS.ErrnoException | undefined;
  const renameImpl = vi.fn((from: string, to: string) => {
    lastError = renameError("EPERM", from, to);
    throw lastError;
  });

  let thrown: unknown;
  try {
    await installArtifact("tool", {
      manifest: installManifest,
      platform: "win32-x64",
      cache: root,
      fetchImpl,
      renameImpl,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
    });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBe(lastError);
  expect((thrown as NodeJS.ErrnoException).code).toBe("EPERM");
  expect((thrown as Error).message).toContain(".staging-");
  expect(renameImpl).toHaveBeenCalledTimes(10);
  expect(waits).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  expect(existsSync(join(root, "tool", "1.0.0", "win32-x64"))).toBe(false);
});

it("does not retry ENOENT on rename", async () => {
  const root = fixture();
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(new Uint8Array(bytes)));
  const waits: number[] = [];
  let originalError: NodeJS.ErrnoException | undefined;
  const renameImpl = vi.fn((from: string, to: string) => {
    originalError = renameError("ENOENT", from, to);
    throw originalError;
  });

  let thrown: unknown;
  try {
    await installArtifact("tool", {
      manifest: installManifest,
      platform: "win32-x64",
      cache: root,
      fetchImpl,
      renameImpl,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
    });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBe(originalError);
  expect((thrown as NodeJS.ErrnoException).code).toBe("ENOENT");
  expect(renameImpl).toHaveBeenCalledTimes(1);
  expect(waits).toEqual([]);
});
