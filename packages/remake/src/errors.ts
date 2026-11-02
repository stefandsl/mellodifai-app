// Errors a person can act on. The worker stores `code` on the remake and the studio turns it
// into a message in the person's language, so a private video or the OpenRouter privacy filter
// never shows up as a stack trace or as corrupted lyrics.
import { REMAKE_MAX_SECONDS, type RemakeErrorCode } from "@mellodifai/shared";

export class RemakeError extends Error {
  constructor(
    readonly code: RemakeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RemakeError";
  }
}

// What yt-dlp prints when it cannot read a video, by reason (its own wording, English).
const YT_DLP_REASONS: [RemakeErrorCode, RegExp][] = [
  [
    "private",
    /private video|this video is private|members-only|join this channel/iu,
  ],
  [
    "age_restricted",
    /age[- ]restricted|confirm your age|inappropriate for some users|age verification/iu,
  ],
  [
    "unavailable",
    /video unavailable|has been removed|no longer available|not available in your country|does not exist|account associated with this video has been terminated|premieres in|live event will begin/iu,
  ],
];

export function classifyYtDlp(output: string): RemakeErrorCode | null {
  for (const [code, pattern] of YT_DLP_REASONS)
    if (pattern.test(output)) return code;
  return null;
}

type Metadata = {
  duration?: number;
  age_limit?: number;
  availability?: string | null;
  is_live?: boolean;
  live_status?: string | null;
};

// Checks the metadata before any media is downloaded.
export function checkMetadata(
  info: Metadata,
  maxSeconds = REMAKE_MAX_SECONDS,
): void {
  if (
    info.availability === "private" ||
    info.availability === "subscriber_only" ||
    info.availability === "premium_only"
  )
    throw new RemakeError("private", "the video is private or members-only");
  if (info.availability === "needs_auth" || (info.age_limit ?? 0) >= 18)
    throw new RemakeError(
      "age_restricted",
      "the video is age-restricted and needs a signed-in account",
    );
  if (
    info.is_live ||
    info.live_status === "is_live" ||
    info.live_status === "is_upcoming"
  )
    throw new RemakeError("unavailable", "live streams cannot be remade");
  const duration = Number(info.duration ?? 0);
  if (Number.isFinite(duration) && duration > maxSeconds)
    throw new RemakeError(
      "too_long",
      `the video lasts ${Math.round(duration)} s; a remake takes songs up to ${maxSeconds} s`,
    );
}
