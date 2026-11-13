import fs, { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { assertObjectMetadataSupport } from "../../lib/native/host.js";
import {
  getAttribute,
  setAttribute,
} from "../../native/storage/fs-xattr/index.js";
import { fixture } from "./fixtures.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, writeFileSync: vi.fn(original.writeFileSync) };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(writeFileSync).mockReset().mockImplementation(fs.writeFileSync);
});
it.skipIf(process.platform !== "win32")(
  "sets and gets metadata, reports missing attributes, follows rename and disappears on deletion",
  async () => {
    const root = fixture();
    const file = join(root, "object");
    const moved = join(root, "moved");
    fs.writeFileSync(file, "bytes");
    await expect(
      getAttribute(file, "user.supabase.content-type"),
    ).rejects.toMatchObject({
      code: "ENODATA",
      syscall: "getxattr",
      path: file,
    });
    await setAttribute(file, "user.supabase.content-type", "audio/mpeg");
    await setAttribute(file, "user.supabase.cache-control", "max-age=123");
    expect(
      (await getAttribute(file, "user.supabase.content-type")).toString(),
    ).toBe("audio/mpeg");
    fs.renameSync(file, moved);
    expect(
      (await getAttribute(moved, "user.supabase.cache-control")).toString(),
    ).toBe("max-age=123");
    expect(fs.readdirSync(root)).toEqual(["moved"]);
    fs.unlinkSync(moved);
    await expect(
      getAttribute(moved, "user.supabase.content-type"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    fs.writeFileSync(moved, "new file");
    await expect(
      getAttribute(moved, "user.supabase.content-type"),
    ).rejects.toMatchObject({ code: "ENODATA" });
  },
);
it("clearly refuses a filesystem without alternate stream support before Storage starts", () => {
  const root = fixture();
  const write = fs.writeFileSync;
  vi.mocked(writeFileSync).mockImplementation((path, data, options) => {
    if (String(path).endsWith(":mdf.probe"))
      throw Object.assign(new Error("unsupported"), { code: "ENOTSUP" });
    return write(path, data, options);
  });
  expect(() => assertObjectMetadataSupport(root, "win32")).toThrow(
    "does not support alternate data streams",
  );
  expect(fs.readdirSync(root)).toEqual([]);
});

it("the stand-in itself reports an unsupported volume clearly", async () => {
  const file = join(fixture(), "object");
  fs.writeFileSync(file, "bytes");
  vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
    throw Object.assign(new Error("invalid stream path"), { code: "EINVAL" });
  });
  await expect(
    setAttribute(file, "user.supabase.content-type", "audio/mpeg"),
  ).rejects.toMatchObject({
    code: "ENOTSUP",
    syscall: "setxattr",
    message:
      "Native Storage metadata requires a volume with alternate data stream support",
  });
});
