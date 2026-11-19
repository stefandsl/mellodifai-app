// One interface for every publishing route (research/2026-11-19/publishing-design.md, section 2).
// YouTube is the native provider today; Blotato and Postiz plug in later behind the same
// interface. The app owns the clock: providers only "stage" privately and "post now".

export const PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "threads",
  "pinterest",
  "bluesky",
] as const;
export type Platform = (typeof PLATFORMS)[number];
export type Format = "landscape" | "vertical" | "square";
export type ProviderId = "native" | "postiz" | "blotato";

// Static limits per platform, written from the official docs and dated.
export interface PlatformRules {
  platform: Platform;
  formats: Format[];
  maxDurationSec: number;
  maxBytes: number;
  captionMax: number;
  titleMax?: number;
  tagsMax?: number;
  thumbnailTextMax?: number;
  firstComment: boolean;
  customThumbnail: boolean;
  aiDisclosureField?: string;
  checkedAt: string;
}

// The owner-editable draft of one platform, frozen when it is approved.
export interface PostDraft {
  platform: Platform;
  accountId: string;
  renderId: string;
  format: Format;
  title?: string;
  caption: string;
  hashtags: string[];
  firstComment?: string;
  thumbnailText?: string;
  aiGenerated: true;
  madeForKids: false;
  platformExtras: Record<string, unknown>;
}

// "definitely_not_accepted" is the only status that allows a new attempt after a handoff.
export type ProviderStatus =
  | "published"
  | "pending"
  | "failed"
  | "definitely_not_accepted"
  | "unknown";

export interface PublishingProvider {
  id: ProviderId;
  platforms(): Promise<Platform[]>;
  accounts(): Promise<
    Array<{
      platform: Platform;
      accountId: string;
      label: string;
      healthy: boolean;
    }>
  >;
  // Problems that block the schedule; empty means valid.
  validate(draft: PostDraft, rules: PlatformRules): Promise<string[]>;
  // Private upload or provider upload; never public.
  stageMedia(draft: PostDraft): Promise<{ mediaRef: string }>;
  postNow(
    draft: PostDraft,
    media: { mediaRef: string },
    attemptId: string,
  ): Promise<{ externalId: string; url?: string }>;
  status(attemptId: string, externalId?: string): Promise<ProviderStatus>;
  makePrivateOrDelete?(externalId: string): Promise<void>;
  analytics?(externalId: string): Promise<Record<string, number>>;
}
