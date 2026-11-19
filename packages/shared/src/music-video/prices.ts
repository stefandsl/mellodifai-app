// kie.ai prices of the music-video line, shared by the worker (ledger reservations) and the
// storyboard quotes. From kie.ai/seedance-2-5 and kie.ai/seedream-5-0-flash, read 2026-11-14
// (credits; "beta, may change"). The SQL quote in ops.music_video_take_request mirrors
// takeQuote; a database test holds the two equal.
export const KIE_PRICES = {
  checked: "2026-11-14",
  // Seedance 2.5 per second. With a reference video the lower rate applies to the reference
  // videos' total length plus the output length; images and audio add nothing. A draft is
  // 480p; its 1080p upgrade keeps the draft's billing mode at the 1080p rate.
  seedance: {
    "480p": { withVideo: 17, noVideo: 28 },
    "720p": { withVideo: 38, noVideo: 63 },
    "1080p": { withVideo: 95, noVideo: 158 },
  },
  // Seedream 5 Flash, 1K to 2K, text or reference-image edit: one price per image.
  seedreamFlashPerImage: 3.24,
} as const;

export type Resolution = keyof typeof KIE_PRICES.seedance;

// Credits of a Seedance generation. Seconds are rounded up, so the estimate never undershoots a
// per-started-second bill.
export function seedanceCredits(options: {
  resolution: Resolution;
  outputSeconds: number;
  referenceVideoSeconds?: number;
}): number {
  const rates = KIE_PRICES.seedance[options.resolution];
  const ref = Math.ceil(options.referenceVideoSeconds ?? 0);
  const out = Math.ceil(options.outputSeconds);
  return ref > 0 ? rates.withVideo * (ref + out) : rates.noVideo * out;
}

export function seedreamCredits(images: number): number {
  return Math.round(KIE_PRICES.seedreamFlashPerImage * images * 100) / 100;
}

// Seedance accepts whole seconds from 4 to 30; a segment is generated at the next whole second
// and trimmed to its frames afterwards.
export function seedanceSeconds(segmentSeconds: number): number {
  const seconds = Math.ceil(segmentSeconds - 1e-6);
  if (seconds > 30) throw new Error("a Seedance shot is at most 30 s");
  return Math.max(4, seconds);
}

export const TAKE_PHASES = ["draft", "final"] as const;
export type TakePhase = (typeof TAKE_PHASES)[number];

// A draft is a 480p Seedance generation; a final is its 1080p upgrade.
export const TAKE_MODELS: Record<TakePhase, string> = {
  draft: "bytedance/seedance-2-5",
  final: "bytedance/seedance-2-5-draft",
};
const TAKE_RESOLUTION: Record<TakePhase, Resolution> = {
  draft: "480p",
  final: "1080p",
};

// The price of one take of a shot. Every shot of the line carries one reference video as long
// as its segment: the black-picture song audio (sung) or the previz clip (instrumental).
export function takeQuote(
  shot: { start_frame: number; end_frame: number },
  fps: number,
  phase: TakePhase,
): { model: string; seconds: number; credits: number } {
  const segmentSeconds = (shot.end_frame - shot.start_frame) / fps;
  const seconds = seedanceSeconds(segmentSeconds);
  return {
    model: TAKE_MODELS[phase],
    seconds,
    credits: seedanceCredits({
      resolution: TAKE_RESOLUTION[phase],
      outputSeconds: seconds,
      referenceVideoSeconds: segmentSeconds,
    }),
  };
}
