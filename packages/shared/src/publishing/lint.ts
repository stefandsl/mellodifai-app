import { YOUTUBE_RULES } from "./rules.js";

// Title and thumbnail text as one pairing, linted. The idea (truncation on mobile, words repeated
// between title and thumbnail, vague words) comes from youtube-agent-skill (MIT, /yt-package);
// this is our own implementation, no text of that project is copied.

export type DraftFields = {
  title: string;
  description: string;
  tags: string[];
  thumbnail_text: string;
};
export type LintIssue = {
  field: keyof DraftFields;
  code: string;
  limit?: number;
};
export type LintResult = { errors: LintIssue[]; warnings: LintIssue[] };

// Mobile search and the home feed cut a title near this many characters.
export const MOBILE_TITLE_CHARS = 60;
const THUMBNAIL_WORDS = 5;
const TAGS_MAX = YOUTUBE_RULES.tagsMax ?? 500;
const THUMBNAIL_MAX = YOUTUBE_RULES.thumbnailTextMax ?? 60;
const VAGUE = new Set([
  "incredibile",
  "pazzesco",
  "assurdo",
  "epico",
  "fantastico",
  "cose",
  "roba",
  "amazing",
  "insane",
  "crazy",
  "epic",
  "best",
  "ultimate",
  "things",
  "stuff",
]);

const words = (text: string) =>
  text
    .toLocaleLowerCase("it")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

// YouTube counts a tag with a space as quoted (+2) and one comma between tags.
export function tagChars(tags: string[]): number {
  return (
    tags.reduce(
      (sum, tag) => sum + tag.length + (tag.includes(" ") ? 2 : 0),
      0,
    ) + Math.max(tags.length - 1, 0)
  );
}

// Errors block the schedule (the database checks them again); warnings never block.
export function lintYouTubeDraft(draft: DraftFields): LintResult {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const title = draft.title;
  const limit = YOUTUBE_RULES.titleMax ?? 100;
  if (!title.trim()) errors.push({ field: "title", code: "required" });
  else if (title.length > limit)
    errors.push({ field: "title", code: "too_long", limit });
  if (/[<>]/u.test(title))
    errors.push({ field: "title", code: "angle_brackets" });
  if (draft.description.length > YOUTUBE_RULES.captionMax)
    errors.push({
      field: "description",
      code: "too_long",
      limit: YOUTUBE_RULES.captionMax,
    });
  if (/[<>]/u.test(draft.description))
    errors.push({ field: "description", code: "angle_brackets" });
  if (tagChars(draft.tags) > TAGS_MAX)
    errors.push({
      field: "tags",
      code: "too_long",
      limit: TAGS_MAX,
    });
  if (draft.thumbnail_text.length > THUMBNAIL_MAX)
    errors.push({
      field: "thumbnail_text",
      code: "too_long",
      limit: THUMBNAIL_MAX,
    });

  if (title.length > MOBILE_TITLE_CHARS && title.length <= limit)
    warnings.push({
      field: "title",
      code: "mobile_cut",
      limit: MOBILE_TITLE_CHARS,
    });
  if (
    title.length >= 12 &&
    title === title.toLocaleUpperCase("it") &&
    /\p{L}/u.test(title)
  )
    warnings.push({ field: "title", code: "all_caps" });
  if (words(title).some((word) => VAGUE.has(word)))
    warnings.push({ field: "title", code: "vague" });
  const thumb = words(draft.thumbnail_text);
  if (!draft.thumbnail_text.trim())
    warnings.push({ field: "thumbnail_text", code: "missing" });
  else {
    const titleWords = new Set(words(title).filter((word) => word.length >= 4));
    if (thumb.some((word) => titleWords.has(word)))
      warnings.push({ field: "thumbnail_text", code: "repeats_title" });
    if (thumb.length > THUMBNAIL_WORDS)
      warnings.push({
        field: "thumbnail_text",
        code: "too_many_words",
        limit: THUMBNAIL_WORDS,
      });
  }
  if (!draft.description.trim())
    warnings.push({ field: "description", code: "empty" });
  if (draft.tags.length === 0) warnings.push({ field: "tags", code: "none" });
  return { errors, warnings };
}
