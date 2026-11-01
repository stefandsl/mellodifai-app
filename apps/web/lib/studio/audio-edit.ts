// The audio editor's processing, as pure functions over decoded channels (Float32Array per
// channel, -1..1). The preview plays the same envelope through Web Audio; the export renders it.

export type EditParams = {
  // The kept part, in seconds of the original.
  start: number;
  end: number;
  // Linear fades inside the kept part, in seconds.
  fadeIn: number;
  fadeOut: number;
  // Scales the kept part so its peak reaches NORMALIZE_PEAK.
  normalize: boolean;
};

export const MIN_LENGTH = 1;
export const MAX_FADE = 10;
// -1 dBFS.
export const NORMALIZE_PEAK = 10 ** (-1 / 20);

export function defaultParams(duration: number): EditParams {
  return { start: 0, end: duration, fadeIn: 0, fadeOut: 0, normalize: false };
}

const round = (value: number, step = 0.01) => Math.round(value / step) * step;

// A valid set for a file of `duration` seconds: the kept part inside the file and at least
// MIN_LENGTH long (when the file is), fades no longer than MAX_FADE and never overlapping.
// `moved` names the edge being set, so the other one stays put (a start dragged past the end
// stops a second before it instead of pushing the end along).
export function clampParams(
  params: EditParams,
  duration: number,
  moved?: "start" | "end",
): EditParams {
  const minLength = Math.min(MIN_LENGTH, duration);
  const wantStart = Number.isFinite(params.start) ? params.start : 0;
  const wantEnd = Number.isFinite(params.end) ? params.end : duration;
  let start: number;
  let end: number;
  if (moved === "start") {
    end = Math.min(duration, Math.max(minLength, wantEnd));
    start = Math.min(Math.max(0, wantStart), end - minLength);
  } else {
    start = Math.min(Math.max(0, wantStart), Math.max(0, duration - minLength));
    end = Math.min(duration, Math.max(start + minLength, wantEnd));
  }
  const length = end - start;
  const fadeIn = Math.min(Math.max(0, params.fadeIn || 0), MAX_FADE, length);
  const fadeOut = Math.min(
    Math.max(0, params.fadeOut || 0),
    MAX_FADE,
    length - fadeIn,
  );
  return { start, end, fadeIn, fadeOut, normalize: params.normalize };
}

export function isUnchanged(params: EditParams, duration: number): boolean {
  return (
    round(params.start) === 0 &&
    round(params.end) === round(duration) &&
    params.fadeIn === 0 &&
    params.fadeOut === 0 &&
    !params.normalize
  );
}

// Sample index of a time, inside the channel.
function sampleAt(seconds: number, sampleRate: number, length: number): number {
  return Math.min(length, Math.max(0, Math.round(seconds * sampleRate)));
}

// The largest absolute sample value between two times, over all channels.
export function peakOf(
  channels: readonly Float32Array[],
  sampleRate: number,
  from: number,
  to: number,
): number {
  let peak = 0;
  for (const channel of channels) {
    const a = sampleAt(from, sampleRate, channel.length);
    const b = sampleAt(to, sampleRate, channel.length);
    for (let i = a; i < b; i++) {
      const value = Math.abs(channel[i] as number);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

// The gain normalising applies to the kept part (1 when off or silent).
export function normalizeGain(
  channels: readonly Float32Array[],
  sampleRate: number,
  params: EditParams,
): number {
  if (!params.normalize) return 1;
  const peak = peakOf(channels, sampleRate, params.start, params.end);
  return peak > 0 ? NORMALIZE_PEAK / peak : 1;
}

// The fade envelope at `t` seconds into the kept part (0..1).
export function envelopeAt(t: number, params: EditParams): number {
  const length = params.end - params.start;
  let gain = 1;
  if (params.fadeIn > 0 && t < params.fadeIn)
    gain = Math.min(gain, Math.max(0, t / params.fadeIn));
  if (params.fadeOut > 0 && t > length - params.fadeOut)
    gain = Math.min(gain, Math.max(0, (length - t) / params.fadeOut));
  return gain;
}

// The edited channels: the kept part, with its fades and the normalising gain.
export function renderEdit(
  channels: readonly Float32Array[],
  sampleRate: number,
  params: EditParams,
): Float32Array[] {
  const gain = normalizeGain(channels, sampleRate, params);
  return channels.map((channel) => {
    const a = sampleAt(params.start, sampleRate, channel.length);
    const b = sampleAt(params.end, sampleRate, channel.length);
    const out = new Float32Array(b - a);
    for (let i = 0; i < out.length; i++) {
      const value =
        (channel[a + i] as number) * gain * envelopeAt(i / sampleRate, params);
      out[i] = Math.max(-1, Math.min(1, value));
    }
    return out;
  });
}

// `count` columns of the peak level (0..1) over all channels, for the waveform.
export function computePeaks(
  channels: readonly Float32Array[],
  count: number,
): Float32Array {
  const peaks = new Float32Array(count);
  const length = channels[0]?.length ?? 0;
  if (!length) return peaks;
  for (let i = 0; i < count; i++) {
    const a = Math.floor((i * length) / count);
    const b = Math.max(a + 1, Math.floor(((i + 1) * length) / count));
    let peak = 0;
    for (const channel of channels)
      for (let j = a; j < b && j < length; j++) {
        const value = Math.abs(channel[j] as number);
        if (value > peak) peak = value;
      }
    peaks[i] = Math.min(1, peak);
  }
  return peaks;
}

// A 16-bit PCM WAV file of the channels (interleaved).
export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataSize = frames * count * 2;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataSize, true);
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (const channel of channels) {
      const value = Math.max(-1, Math.min(1, channel[i] as number));
      view.setInt16(
        at,
        Math.round(value < 0 ? value * 0x8000 : value * 0x7fff),
        true,
      );
      at += 2;
    }
  return new Uint8Array(view.buffer);
}

// "1:05.3" (tenths) or "1:05".
export function formatClock(seconds: number, tenths = false): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = tenths ? Math.round(safe * 10) / 10 : Math.floor(safe);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  const secs = tenths
    ? rest.toFixed(1).padStart(4, "0")
    : String(Math.floor(rest)).padStart(2, "0");
  return `${minutes}:${secs}`;
}

// Reads "1:05.3", "65.3" or "65,3" back into seconds; null for anything else.
export function parseClock(text: string): number | null {
  const found = /^\s*(?:(\d+):)?(\d+(?:[.,]\d+)?)\s*$/u.exec(text);
  if (!found) return null;
  const minutes = found[1] ? Number(found[1]) : 0;
  const seconds = Number((found[2] as string).replace(",", "."));
  if (found[1] && seconds >= 60) return null;
  return minutes * 60 + seconds;
}
