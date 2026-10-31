import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { SupabaseStorage } from "../src/storage.js";

vi.mock("node:fs/promises", () => ({
  stat: async () => ({ size: 10 * 1024 * 1024 }),
  readFile: async () => Buffer.from("preview"),
}));
it("counts all pages and subtracts replaced object size before the quota check", async () => {
  const upload = vi.fn(async () => ({ error: null }));
  const list = vi.fn(async (_prefix: string, options: { offset?: number }) => ({
    error: null,
    data:
      options.offset === 0
        ? Array.from({ length: 1000 }, (_, i) => ({
            id: String(i),
            name: i === 0 ? "video.mp4" : `other-${i}`,
            metadata: { size: i === 0 ? 28 * 1024 * 1024 : 0 },
          }))
        : [{ id: "last", name: "last", metadata: { size: 880 * 1024 * 1024 } }],
  }));
  const storage = new SupabaseStorage({
    storage: { from: () => ({ list, upload }) },
  } as unknown as SupabaseClient);
  await storage.upload("video.mp4", "local", "video/mp4");
  expect(upload).toHaveBeenCalledWith("video.mp4", expect.any(Buffer), {
    contentType: "video/mp4",
    upsert: true,
  });
  expect(list).toHaveBeenCalledTimes(2);
  upload.mockClear();
  await expect(storage.upload("new.mp4", "local", "video/mp4")).rejects.toThrow(
    "storage almost full",
  );
  expect(upload).not.toHaveBeenCalled();
});
