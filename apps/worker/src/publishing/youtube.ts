import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  lintYouTubeDraft,
  type Platform,
  type PlatformRules,
  type PostDraft,
  type ProviderStatus,
  type PublishingProvider,
} from "@mellodifai/shared";
import { workerTempDir } from "../runtime.js";
import { PublishError } from "./dispatcher.js";

// The YouTube Data API through the engine's publish/yt.py, or a fake in WORKER_FAKE mode.
// The private upload is the existing `publish` stage (stages/publish.ts, privacyStatus private);
// this client pushes the approved metadata, flips the private video to public at the app's slot
// and reads it back.
// The video's privacyStatus and its YouTube publishAt (set by the old flow), or null when YouTube
// did not answer.
export type VideoState = { privacy: string; publishAt: string | null };
// What the owner approved; the private upload may carry an older draft (veto, then a new plan).
export type ApprovedMeta = {
  title: string;
  description: string;
  tags: string[];
  thumbnailText: string;
  // The base thumbnail the approved text goes on; null when it is not known.
  thumbnail: string | null;
};
export interface YouTubeClient {
  // videos.update of the snippet, then the thumbnail with the approved text; throws on refusal.
  update(videoId: string, meta: ApprovedMeta): Promise<void>;
  // Public now. Never sends publishAt: the app owns the clock.
  setPublic(videoId: string): Promise<void>;
  state(videoId: string): Promise<VideoState | null>;
}

export type ScriptRunner = (args: string[]) => Promise<string>;

export function ytScriptClient(
  run: ScriptRunner,
  tempDir: string = workerTempDir(),
): YouTubeClient {
  return {
    async update(videoId, meta) {
      await mkdir(tempDir, { recursive: true });
      const file = join(tempDir, `yt-approved-${randomUUID()}.json`);
      await writeFile(
        file,
        JSON.stringify({
          title: meta.title,
          description: meta.description,
          tags: meta.tags,
          thumbnail_text: meta.thumbnailText,
          thumbnail: meta.thumbnail,
        }),
      );
      try {
        await run(["update", videoId, file, "--confirm"]);
      } finally {
        await rm(file, { force: true });
      }
    },
    async setPublic(videoId) {
      await run(["privacy", videoId, "public", "--confirm"]);
    },
    async state(videoId) {
      const output = await run(["status", videoId]);
      const start = output.indexOf("{");
      const end = output.lastIndexOf("}");
      if (start < 0 || end < start) return null;
      try {
        const parsed = JSON.parse(output.slice(start, end + 1)) as {
          status?: { privacyStatus?: unknown; publishAt?: unknown };
        };
        const privacy = parsed.status?.privacyStatus;
        const publishAt = parsed.status?.publishAt;
        return typeof privacy === "string"
          ? {
              privacy,
              publishAt:
                typeof publishAt === "string" && publishAt ? publishAt : null,
            }
          : null;
      } catch {
        return null;
      }
    },
  };
}

// Fake YouTube for tests and the e2e stack: no network, every video starts private.
// failNext: "refuse" = error, still private; "lost" = public but the answer is lost;
// "dark" = error and YouTube no longer answers about this video; "update" = the metadata update
// is refused. meta holds each video's current title, description, tags and thumbnail text.
export class FakeYouTubeClient implements YouTubeClient {
  readonly calls: Array<{
    op: "update" | "setPublic" | "state";
    videoId: string;
  }> = [];
  readonly meta = new Map<string, ApprovedMeta>();
  readonly videos = new Map<string, string | null>();
  // A YouTube publishAt left by the old flow.
  readonly publishAt = new Map<string, string>();
  failNext: "refuse" | "lost" | "dark" | "update" | null = null;
  async update(videoId: string, meta: ApprovedMeta) {
    this.calls.push({ op: "update", videoId });
    if (this.failNext === "update") {
      this.failNext = null;
      throw new Error("fake YouTube refused the update");
    }
    this.meta.set(videoId, { ...meta, tags: [...meta.tags] });
  }
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
  async state(videoId: string) {
    this.calls.push({ op: "state", videoId });
    const value = this.videos.get(videoId);
    if (value === null) return null;
    return {
      privacy: value ?? "private",
      publishAt: this.publishAt.get(videoId) ?? null,
    };
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
  // The approved metadata first: if YouTube refuses it, the video never goes public.
  async postNow(
    draft: PostDraft,
    media: { mediaRef: string },
    _attemptId: string,
  ) {
    const thumbnail = draft.platformExtras.thumbnail;
    try {
      await this.client.update(media.mediaRef, {
        title: draft.title ?? "",
        description: draft.caption,
        tags: draft.hashtags,
        thumbnailText: draft.thumbnailText ?? "",
        thumbnail: typeof thumbnail === "string" && thumbnail ? thumbnail : null,
      });
    } catch (error) {
      throw new PublishError("metadata_update_failed", String(error));
    }
    try {
      await this.client.setPublic(media.mediaRef);
    } catch (error) {
      throw new PublishError("set_public_failed", String(error));
    }
    return {
      externalId: media.mediaRef,
      url: `https://youtu.be/${encodeURIComponent(media.mediaRef)}`,
    };
  }
  // Only a video that is still private with no YouTube publishAt allows a new attempt; a private
  // video with a publishAt is scheduled by YouTube's own clock; anything else needs the owner.
  async status(
    _attemptId: string,
    externalId?: string,
  ): Promise<ProviderStatus> {
    if (!externalId) return "unknown";
    const video = await this.client.state(externalId);
    if (video?.privacy === "public") return "published";
    if (video?.privacy === "private")
      return video.publishAt ? "scheduled" : "definitely_not_accepted";
    return "unknown";
  }
}
