// MP3 encoding in the browser with LAME compiled to WebAssembly (wasm-media-encoders, loaded only
// when needed). Encodes in slices and yields between them, so the page stays responsive and can
// show progress.

export const MP3_BITRATE = 320;
// LAME frames are 1152 samples; a slice is about 1.5 s at 44.1 kHz.
const SLICE = 1152 * 56;

type Encoder = {
  configure(params: {
    channels: 1 | 2;
    sampleRate: number;
    bitrate: 320;
  }): void;
  encode(samples: readonly Float32Array[]): Uint8Array;
  finalize(): Uint8Array;
};

export type EncodeOptions = {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  // For tests: the encoder to use instead of the WebAssembly one.
  createEncoder?: () => Promise<Encoder>;
};

const yieldToPage = () => new Promise((resolve) => setTimeout(resolve, 0));

// More than two channels are folded into stereo: LAME takes one or two.
export function toStereo(channels: readonly Float32Array[]): Float32Array[] {
  if (channels.length <= 2) return [...channels];
  const frames = channels[0]?.length ?? 0;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  channels.forEach((channel, i) => {
    const target = i % 2 === 0 ? left : right;
    for (let j = 0; j < frames; j++)
      target[j] = (target[j] as number) + (channel[j] as number);
  });
  const scale = 2 / channels.length;
  for (let j = 0; j < frames; j++) {
    left[j] = (left[j] as number) * scale;
    right[j] = (right[j] as number) * scale;
  }
  return [left, right];
}

export async function encodeMp3(
  input: readonly Float32Array[],
  sampleRate: number,
  { onProgress, signal, createEncoder }: EncodeOptions = {},
): Promise<Blob> {
  const channels = toStereo(input);
  const make =
    createEncoder ??
    (async () =>
      (
        await import("wasm-media-encoders")
      ).createMp3Encoder() as Promise<Encoder>);
  const encoder = await make();
  encoder.configure({
    channels: channels.length === 1 ? 1 : 2,
    sampleRate,
    bitrate: MP3_BITRATE,
  });
  const frames = channels[0]?.length ?? 0;
  const parts: Uint8Array[] = [];
  for (let at = 0; at < frames; at += SLICE) {
    signal?.throwIfAborted();
    const slice = channels.map((channel) => channel.subarray(at, at + SLICE));
    // The encoder returns a view into its own memory: copy it before the next call.
    parts.push(encoder.encode(slice).slice());
    onProgress?.(Math.min(1, (at + SLICE) / Math.max(1, frames)));
    await yieldToPage();
  }
  parts.push(encoder.finalize().slice());
  onProgress?.(1);
  return new Blob(parts as BlobPart[], { type: "audio/mpeg" });
}
