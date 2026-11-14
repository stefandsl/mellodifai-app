import type { KieClient } from "./kie-client.js";

// kie.ai media models used by the music-video line. Request shapes from docs.kie.ai, read
// 2026-11-14: market/bytedance/seedance-2-5, market/bytedance/seedance-2-5-draft,
// market/seedream/5-flash-text-to-image and 5-flash-image-to-image.
export const SEEDANCE = "bytedance/seedance-2-5";
export const SEEDANCE_UPGRADE = "bytedance/seedance-2-5-draft";
export const SEEDREAM_T2I = "seedream/5-flash-text-to-image";
export const SEEDREAM_I2I = "seedream/5-flash-image-to-image";

// Prices and the Seedance length rule live in @mellodifai/shared (storyboard quotes use them too).
export {
  KIE_PRICES,
  type Resolution,
  seedanceCredits,
  seedanceSeconds,
  seedreamCredits,
} from "@mellodifai/shared";

export type SeedanceDraftRequest = {
  prompt: string;
  imageUrls: string[];
  videoUrls: string[];
  seconds: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
};

export function seedanceDraftBody(request: SeedanceDraftRequest) {
  if (request.imageUrls.length > 30 || request.videoUrls.length > 10)
    throw new Error("too many Seedance references");
  return {
    model: SEEDANCE,
    input: {
      prompt: request.prompt,
      ...(request.imageUrls.length
        ? { reference_image_urls: request.imageUrls }
        : {}),
      ...(request.videoUrls.length
        ? { reference_video_urls: request.videoUrls }
        : {}),
      ...(request.imageUrls.length || request.videoUrls.length
        ? { omni_reference_task_type: "reference" }
        : {}),
      generate_audio: true,
      resolution: "480p",
      draft: true,
      aspect_ratio: request.aspectRatio ?? "16:9",
      duration: request.seconds,
      return_last_frame: true,
      output_format: "mp4",
    },
  };
}

// The 1080p version of a draft (valid for 7 days after the draft).
export function seedanceUpgradeBody(draftTaskId: string) {
  if (!draftTaskId) throw new Error("upgrade needs the draft task id");
  return {
    model: SEEDANCE_UPGRADE,
    input: {
      draft_task_id: draftTaskId,
      resolution: "1080p",
      output_format: "mp4",
    },
  };
}

export function seedreamBody(options: {
  prompt: string;
  imageUrls?: string[];
  aspectRatio: "16:9" | "3:4" | "2:3" | "1:1";
}) {
  const edit = (options.imageUrls?.length ?? 0) > 0;
  return {
    model: edit ? SEEDREAM_I2I : SEEDREAM_T2I,
    input: {
      prompt: options.prompt,
      ...(edit ? { image_urls: options.imageUrls } : {}),
      aspect_ratio: options.aspectRatio,
      size: "2K",
      output_format: "png",
    },
  };
}

// The media URLs of a finished market task: `resultJson` is a JSON string with `resultUrls`
// (and `lastFrameUrl` for Seedance when asked).
export function resultUrls(data: unknown): {
  urls: string[];
  lastFrame?: string;
  credits?: number;
} {
  const record = (data ?? {}) as {
    resultJson?: unknown;
    creditsConsumed?: unknown;
  };
  let parsed: unknown = record.resultJson;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  const result = (parsed ?? {}) as {
    resultUrls?: unknown;
    lastFrameUrl?: unknown;
  };
  const urls = Array.isArray(result.resultUrls)
    ? result.resultUrls.filter(
        (u): u is string => typeof u === "string" && u.startsWith("https://"),
      )
    : [];
  const last = Array.isArray(result.lastFrameUrl)
    ? result.lastFrameUrl[0]
    : result.lastFrameUrl;
  const credits = Number(record.creditsConsumed);
  return {
    urls,
    ...(typeof last === "string" && last.startsWith("https://")
      ? { lastFrame: last }
      : {}),
    ...(Number.isFinite(credits) ? { credits } : {}),
  };
}

export type MediaTask = {
  taskId: string;
  urls: string[];
  lastFrame?: string;
  credits?: number;
};

// Submits a market task and waits for its media. A refusal (KieRefused) costs nothing; any other
// error after submission leaves the task id in the error so nobody submits it twice.
export async function runMediaTask(
  client: KieClient,
  body: { model: string; input: Record<string, unknown> },
  options: {
    timeoutMs?: number;
    pollMs?: number;
    onSubmitted?: (taskId: string) => Promise<void> | void;
  } = {},
): Promise<MediaTask> {
  const taskId = await client.createTask(body);
  await options.onSubmitted?.(taskId);
  try {
    const { data } = await client.wait(taskId, {
      timeoutMs: options.timeoutMs ?? 40 * 60_000,
      pollMs: options.pollMs ?? 15_000,
    });
    const result = resultUrls(data);
    if (!result.urls.length) throw new Error("kie task has no media URL");
    return { taskId, ...result };
  } catch (error) {
    throw new Error(`kie task ${taskId}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
