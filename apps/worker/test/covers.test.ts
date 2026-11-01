import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { sunoCoverUrls } from "../src/stages/generate-song.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

it("reads Suno's artwork per take from kie's record.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "covers-"));
  dirs.push(dir);
  await writeFile(
    join(dir, "record.json"),
    JSON.stringify({
      data: {
        response: {
          data: [
            { image_url: "https://cdn2.suno.ai/image_a.jpeg" },
            { image_url: 42 },
          ],
        },
      },
    }),
  );
  expect(await sunoCoverUrls(dir)).toEqual([
    "https://cdn2.suno.ai/image_a.jpeg",
    "",
  ]);
});

it("returns no covers when record.json is missing or broken", async () => {
  const dir = await mkdtemp(join(tmpdir(), "covers-"));
  dirs.push(dir);
  expect(await sunoCoverUrls(dir)).toEqual([]);
  await writeFile(join(dir, "record.json"), "{not json");
  expect(await sunoCoverUrls(dir)).toEqual([]);
});
