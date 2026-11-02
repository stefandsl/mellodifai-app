import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createFakeMedia } from "../src/fake/index.js";
import type { StageContext } from "../src/loop.js";

afterEach(() => vi.unstubAllEnvs());

it("places default fake media beneath the configured runtime, not a Windows drive literal", async () => {
  const base = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "worker-runtime-test-"));
  vi.stubEnv("RUNNER_TEMP", root);
  let media: Awaited<ReturnType<typeof createFakeMedia>> | undefined;
  try {
    const run = vi.fn().mockResolvedValue({ code: 0 });
    media = await createFakeMedia({
      engine: { run },
    } as unknown as StageContext);
    expect(media.root.startsWith(join(root, "tmp"))).toBe(true);
    expect(run).toHaveBeenCalledTimes(3);
  } finally {
    if (media) await rm(media.root, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
