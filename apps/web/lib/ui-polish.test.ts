import { LANGS } from "@mellodifai/shared";
import { expect, it } from "vitest";
import { publicationDefaults } from "./publication-defaults";
import { orderedVersions, selectedVersion } from "./versions";

it("orders versions by LANGS without mutating database results and defaults to Italian", () => {
  const versions = [...LANGS].reverse().map((lang) => ({ lang }));
  expect(orderedVersions(versions).map((v) => v.lang)).toEqual(LANGS);
  expect(versions[0].lang).toBe("fr");
  expect(selectedVersion(versions)?.lang).toBe("it");
  expect(selectedVersion(versions, "ja")?.lang).toBe("ja");
  expect(selectedVersion([{ lang: "en" }, { lang: "ru" }])?.lang).toBe("ru");
  expect(selectedVersion(versions, "invalid")?.lang).toBe("it");
  expect(selectedVersion([])).toBeUndefined();
});
it("cleans title tags, retains bracket acronyms and deduplicates case-insensitively", () => {
  expect(
    publicationDefaults("Va bene, passa (VBP)", "", "it", null, "it").tags,
  ).toBe("Va bene passa, VBP, lyric video, it");
  expect(
    publicationDefaults("Hello hello!!! [AI] (AI)", "", "en", null, "en").tags,
  ).toBe("Hello, AI, lyric video, en");
  expect(publicationDefaults("Hi", "", "en", null, "en").tags).toBe(
    "lyric video, en",
  );
  const tags = publicationDefaults(
    "Longword ".repeat(100) + "x".repeat(600),
    "",
    "it",
    null,
    "it",
  ).tags;
  expect(tags.length).toBeLessThanOrEqual(500);
  expect(tags.endsWith("lyric video, it")).toBe(true);
});
