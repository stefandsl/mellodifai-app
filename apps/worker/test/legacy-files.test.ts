import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LANGS } from "@mellodifai/shared";
import { afterEach, expect, it, vi } from "vitest";
import { createLegacyFiles } from "../src/legacy-import.js";
import { draftReference } from "../src/stages/draft-lyrics.js";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), access: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("transcodes video and hook into E tmp while replacing the historic storage keys", async () => {
  const encode = vi.fn(async () => {});
  const files = createLegacyFiles(undefined, undefined, encode);
  const uploads = await files.uploads("it", "owner", "project");
  expect(encode).toHaveBeenCalledTimes(2);
  for (const kind of ["video", "hook"]) {
    const localFile = join(
      "E:\\mellodifai\\tmp",
      `project-it-${kind}-480p.mp4`,
    );
    expect(encode).toHaveBeenCalledWith(
      expect.stringContaining(`${kind}.mp4`),
      localFile,
    );
    expect(uploads).toContainEqual({
      path: `previews/owner/project/it/${kind === "video" ? "video-720p" : "hook"}.mp4`,
      localFile,
      contentType: "video/mp4",
    });
  }
});
function fakeFiles() {
  vi.mocked(readFile).mockImplementation(async (path) => {
    const name = String(path).replaceAll("\\", "/");
    if (name.endsWith("lyrics.txt")) {
      const lang = name.split("/").at(-2);
      const count = lang === "en" ? 82 : lang === "de" ? 86 : 80;
      return Array.from({ length: count }, (_, i) => `${lang} line ${i}`).join(
        "\n",
      );
    }
    if (name.endsWith("title.txt") || name.endsWith("style.txt"))
      return "fixture";
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
}
it("reads all shipped packs with missing optional files and preserves 82/86-line lyrics", async () => {
  fakeFiles();
  for (const lang of LANGS) {
    const pack = await createLegacyFiles().readPack(lang);
    expect(pack.l10n).toEqual({});
    expect(pack.settings).toEqual({});
    expect(pack.displayMap).toEqual({});
    expect(pack.exclude).toBe("");
    expect(pack.lyrics.split("\n")).toHaveLength(
      lang === "en" ? 82 : lang === "de" ? 86 : 80,
    );
  }
});
it.each(["en", "de"])(
  "uses Italian structure and %s vocabulary",
  async (lang) => {
    fakeFiles();
    const reference = await draftReference(lang);
    expect(reference).toContain("80-line structural template");
    expect(reference).toContain("it line 79");
    expect(reference).toContain("Style/vocabulary only");
    expect(reference).toContain(`${lang} line 81`);
  },
);
it("does not hide malformed optional JSON", async () => {
  vi.mocked(readFile).mockResolvedValue("invalid json");
  await expect(createLegacyFiles().readPack("it")).rejects.toThrow();
});
