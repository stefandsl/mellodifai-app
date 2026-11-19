import {
  lintYouTubeDraft,
  type Platform,
  type PlatformRules,
  type PostDraft,
  type ProviderStatus,
  type PublishingProvider,
} from "@mellodifai/shared";

// The YouTube Data API through the engine's publish/yt.py, or a fake in WORKER_FAKE mode.
// The private upload is the existing `publish` stage (stages/publish.ts, privacyStatus private);
// this client only flips an uploaded private video to public at the app's slot and reads it back.
export interface YouTubeClient {
  // Public now. Never sends publishAt: the app owns the clock.
  setPublic(videoId: string): Promise<void>;
  // The video's privacyStatus, or null when YouTube did not answer.
  privacy(videoId: string): Promise<string | null>;
}

export type ScriptRunner = (args: string[]) => Promise<string>;

export function ytScriptClient(run: ScriptRunner): YouTubeClient {
  return {
    async setPublic(videoId) {
      await run(["privacy", videoId, "public", "--confirm"]);
    },
    async privacy(videoId) {
      const output = await run(["status", videoId]);
      const start = output.indexOf("{");
      const end = output.lastIndexOf("}");
      if (start < 0 || end < start) return null;
      try {
        const parsed = JSON.parse(output.slice(start, end + 1)) as {
          status?: { privacyStatus?: unknown };
        };
        return typeof parsed.status?.privacyStatus === "string"
          ? parsed.status.privacyStatus
          : null;
      } catch {
        return null;
      }
    },
  };
}

// Fake YouTube for tests and the e2e stack: no network, every video starts private.
// failNext: "refuse" = error, still private; "lost" = public but the answer is lost;
// "dark" = error and YouTube no longer answers about this video.
export class FakeYouTubeClient implements YouTubeClient {
  readonly calls: Array<{ op: "setPublic" | "privacy"; videoId: string }> = [];
  readonly videos = new Map<string, string | null>();
  failNext: "refuse" | "lost" | "dark" | null = null;
  async setPublic(videoId: string) {
    this.calls.push({ op: "setPublic", videoId });
    const fail = this.failNext;
    this.failNext = null;
    if (fail === "refuse") throw new Error("fake YouTube refused");
    if (fail === "dark") {
      this.videos.set(videoId, null);
      throw new Error("fake YouTube timed out");
    }
    this.videos.set(videoId, "public");
    if (fail === "lost") throw new Error("fake YouTube answer lost");
  }
  async privacy(videoId: string) {
    this.calls.push({ op: "privacy", videoId });
    const value = this.videos.get(videoId);
    return value === undefined ? "private" : value;
  }
}

export class YouTubeProvider implements PublishingProvider {
  readonly id = "native" as const;
  constructor(private readonly client: YouTubeClient) {}
  async platforms(): Promise<Platform[]> {
    return ["youtube"];
  }
  async accounts() {
    return [
      {
        platform: "youtube" as const,
        accountId: "default",
        label: "YouTube",
        healthy: true,
      },
    ];
  }
  async validate(draft: PostDraft, _rules: PlatformRules) {
    return lintYouTubeDraft({
      title: draft.title ?? "",
      description: draft.caption,
      tags: draft.hashtags,
      thumbnail_text: draft.thumbnailText ?? "",
    }).errors.map((issue) => `${issue.field}:${issue.code}`);
  }
  // The publish job already uploaded the video privately; its id is the media reference.
  async stageMedia(draft: PostDraft) {
    const videoId = draft.platformExtras.videoId;
    if (typeof videoId !== "string" || !videoId)
      throw new Error("private upload pending");
    return { mediaRef: videoId };
  }
  async postNow(
    _draft: PostDraft,
    media: { mediaRef: string },
    _attemptId: string,
  ) {
    await this.client.setPublic(media.mediaRef);
    return {
      externalId: media.mediaRef,
      url: `https://youtu.be/${encodeURIComponent(media.mediaRef)}`,
    };
  }
  // Only a video that is still private allows a new attempt; anything else needs the owner.
  async status(
    _attemptId: string,
    externalId?: string,
  ): Promise<ProviderStatus> {
    if (!externalId) return "unknown";
    const privacy = await this.client.privacy(externalId);
    if (privacy === "public") return "published";
    if (privacy === "private") return "definitely_not_accepted";
    return "unknown";
  }
}
