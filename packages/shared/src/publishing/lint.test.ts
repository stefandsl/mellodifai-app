import { expect, it } from "vitest";
import { type DraftFields, lintYouTubeDraft, tagChars } from "./lint.js";

const base = {
  title: "Mille volti",
  description: "Testo",
  tags: ["pop"],
  thumbnail_text: "Nuovo singolo",
};

it("passes a clean pairing", () => {
  expect(lintYouTubeDraft(base)).toEqual({ errors: [], warnings: [] });
});

it("blocks the same hard limits as the database", () => {
  const result = lintYouTubeDraft({
    title: "x".repeat(101),
    description: `a<b${"c".repeat(5000)}`,
    tags: ["y".repeat(501)],
    thumbnail_text: "z".repeat(61),
  });
  expect(result.errors.map((issue) => `${issue.field}:${issue.code}`)).toEqual([
    "title:too_long",
    "description:too_long",
    "description:angle_brackets",
    "tags:too_long",
    "thumbnail_text:too_long",
  ]);
  expect(lintYouTubeDraft({ ...base, title: " " }).errors).toEqual([
    { field: "title", code: "required" },
  ]);
  expect(lintYouTubeDraft({ ...base, title: "x".repeat(100) }).errors).toEqual(
    [],
  );
});

it("warns on a cut title, a repeated or long thumbnail text and vague words", () => {
  const codes = (draft: Partial<typeof base>) =>
    lintYouTubeDraft({ ...base, ...draft }).warnings.map(
      (issue) => `${issue.field}:${issue.code}`,
    );
  expect(codes({ title: "a".repeat(61) })).toEqual(["title:mobile_cut"]);
  expect(codes({ thumbnail_text: "MILLE volti per sempre" })).toEqual([
    "thumbnail_text:repeats_title",
  ]);
  expect(codes({ thumbnail_text: "uno due tre quattro cinque sei" })).toEqual([
    "thumbnail_text:too_many_words",
  ]);
  expect(codes({ title: "Un video pazzesco" })).toEqual(["title:vague"]);
  expect(codes({ title: "TUTTO IN MAIUSCOLO" })).toEqual(["title:all_caps"]);
  expect(codes({ thumbnail_text: "", description: "", tags: [] })).toEqual([
    "thumbnail_text:missing",
    "description:empty",
    "tags:none",
  ]);
});

it("counts tags like YouTube: quotes around a space and commas between", () => {
  expect(tagChars(["a b", "cd"])).toBe(5 + 2 + 1);
  expect(tagChars([])).toBe(0);
});

it("pairs the picked cover with the thumbnail text: the cover already shows the title", () => {
  const codes = (draft: Partial<DraftFields>) =>
    lintYouTubeDraft({ ...base, ...draft }).warnings.map(
      (issue) => `${issue.field}:${issue.code}`,
    );
  // A picked cover needs no thumbnail text; text on top of it is flagged, never blocked.
  expect(codes({ thumbnail_text: "", cover: "cover-2" })).toEqual([]);
  expect(codes({ thumbnail_text: "Nuovo singolo", cover: "cover-1" })).toEqual([
    "cover:text_on_cover",
  ]);
  expect(codes({ thumbnail_text: "", cover: "" })).toEqual([
    "thumbnail_text:missing",
  ]);
});
