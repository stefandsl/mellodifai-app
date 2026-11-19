import type { Platform, PlatformRules } from "./provider.js";

// YouTube Data API v3 limits (videos.insert snippet, thumbnails.set), checked 2026-11-19.
// The database (ops._publish_problems) enforces the same hard limits.
export const YOUTUBE_RULES: PlatformRules = {
  platform: "youtube",
  formats: ["landscape", "vertical"],
  maxDurationSec: 12 * 3600,
  maxBytes: 256 * 1024 ** 3,
  captionMax: 5000,
  titleMax: 100,
  tagsMax: 500,
  thumbnailTextMax: 60,
  firstComment: false,
  customThumbnail: true,
  aiDisclosureField: "containsSyntheticMedia",
  checkedAt: "2026-11-19",
};

// Owner decision 2026-11-19: YouTube only for now. The others show as "presto" in the dashboard.
export const ACTIVE_PLATFORMS: readonly Platform[] = ["youtube"];
export const SOON_PLATFORMS: readonly Platform[] = [
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "threads",
  "pinterest",
  "bluesky",
];
export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  threads: "Threads",
  pinterest: "Pinterest",
  bluesky: "Bluesky",
};
