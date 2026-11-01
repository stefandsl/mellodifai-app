// Audio analysis shared by the preview and the render.
//
// The preview reads a Web Audio AnalyserNode (fftSize 2048, smoothingTimeConstant 0, decibels
// -100 to -30). The render PC has no analyser, so `frequencyBytes` and `timeBytes` compute the
// same numbers from decoded samples, following the Web Audio specification of
// getByteFrequencyData (Blackman window, FFT, magnitude / N, 20 log10, scaled to bytes) and
// getByteTimeDomainData. Everything after those bytes (bands, smoothing, level) is the same
// code in both places.

export const FFT_SIZE = 2048;
export const MIN_DB = -100;
export const MAX_DB = -30;
// The render decodes at the rate most browsers run their AudioContext at.
export const ANALYSIS_RATE = 48000;
export const BAND_COUNT = 64;
export const WAVE_POINTS = 256;
const LOW_HZ = 30;
const HIGH_HZ = 16000;

let windowCache: Float64Array | null = null;
// The Blackman window of the specification (alpha 0.16).
export function blackman(n = FFT_SIZE): Float64Array {
  if (windowCache?.length === n) return windowCache;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++)
    w[i] =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * i) / n) +
      0.08 * Math.cos((4 * Math.PI * i) / n);
  if (n === FFT_SIZE) windowCache = w;
  return w;
}

// In-place iterative radix-2 FFT of (re, im), length a power of two.
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = step * k;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const a = start + k;
        const b = a + half;
        const br = re[b] as number;
        const bi = im[b] as number;
        const tr = br * cos - bi * sin;
        const ti = br * sin + bi * cos;
        re[b] = (re[a] as number) - tr;
        im[b] = (im[a] as number) - ti;
        re[a] = (re[a] as number) + tr;
        im[a] = (im[a] as number) + ti;
      }
    }
  }
}

// The FFT_SIZE samples that end at sample `end` (exclusive); silence before the start.
function windowAt(samples: ArrayLike<number>, end: number): Float64Array {
  const out = new Float64Array(FFT_SIZE);
  const from = end - FFT_SIZE;
  for (let i = 0; i < FFT_SIZE; i++) {
    const at = from + i;
    out[i] = at >= 0 && at < samples.length ? (samples[at] as number) : 0;
  }
  return out;
}

// getByteFrequencyData for the analyser window ending at sample `end`.
export function frequencyBytes(
  samples: ArrayLike<number>,
  end: number,
): Uint8Array {
  const re = windowAt(samples, end);
  const im = new Float64Array(FFT_SIZE);
  const w = blackman();
  for (let i = 0; i < FFT_SIZE; i++)
    re[i] = (re[i] as number) * (w[i] as number);
  fft(re, im);
  const out = new Uint8Array(FFT_SIZE / 2);
  const scale = 255 / (MAX_DB - MIN_DB);
  for (let k = 0; k < FFT_SIZE / 2; k++) {
    const magnitude = Math.hypot(re[k] as number, im[k] as number) / FFT_SIZE;
    const db = magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity;
    out[k] = Math.max(0, Math.min(255, Math.floor(scale * (db - MIN_DB))));
  }
  return out;
}

// getByteTimeDomainData for the window ending at sample `end`.
export function timeBytes(samples: ArrayLike<number>, end: number): Uint8Array {
  const values = windowAt(samples, end);
  const out = new Uint8Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++)
    out[i] = Math.max(
      0,
      Math.min(255, Math.floor(128 * (1 + (values[i] as number)))),
    );
  return out;
}

// Edges of the log-spaced bands in FFT bins, cached per sample rate.
const bandCache = new Map<number, Int32Array>();
export function bandEdges(sampleRate: number): Int32Array {
  const cached = bandCache.get(sampleRate);
  if (cached) return cached;
  const binHz = sampleRate / FFT_SIZE;
  const edges = new Int32Array(BAND_COUNT + 1);
  let last = 0;
  for (let i = 0; i <= BAND_COUNT; i++) {
    const hz = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (i / BAND_COUNT);
    // Every band gets at least one bin of its own.
    const bin = Math.max(i === 0 ? 0 : last + 1, Math.round(hz / binHz));
    edges[i] = Math.min(FFT_SIZE / 2, bin);
    last = edges[i] as number;
  }
  bandCache.set(sampleRate, edges);
  return edges;
}

// 64 bands, 0..1, from the analyser's 1024 frequency bytes: the mean of each band's bins with
// a gentle tilt up for the treble, which carries less energy than the bass.
export function bandsFromBytes(
  bytes: ArrayLike<number>,
  sampleRate: number,
): Float32Array {
  const edges = bandEdges(sampleRate);
  const out = new Float32Array(BAND_COUNT);
  for (let i = 0; i < BAND_COUNT; i++) {
    const lo = edges[i] as number;
    const hi = Math.max(lo + 1, edges[i + 1] as number);
    let sum = 0;
    let count = 0;
    for (let k = lo; k < hi && k < bytes.length; k++) {
      sum += bytes[k] as number;
      count++;
    }
    const mean = count ? sum / count / 255 : 0;
    const tilt = 0.85 + 0.35 * (i / (BAND_COUNT - 1));
    out[i] = Math.min(1, mean * tilt);
  }
  return out;
}

// WAVE_POINTS samples, -1..1, from the analyser's 2048 time-domain bytes. Like an
// oscilloscope it starts on a rising zero crossing in the first half and shows half the
// window, so the line stands still on a steady note instead of crawling, and the preview and the
// render (whose analyser clocks differ by a few samples) show the same shape.
export function waveFromBytes(bytes: ArrayLike<number>): Float32Array {
  const out = new Float32Array(WAVE_POINTS);
  const span = Math.floor(bytes.length / 2);
  // The trigger looks at a smoothed copy, so treble and noise cannot move it.
  const R = 24;
  const smooth = (at: number) => {
    let sum = 0;
    for (let k = at - R; k <= at + R; k++)
      sum +=
        (bytes[Math.max(0, Math.min(bytes.length - 1, k))] as number) - 128;
    return sum;
  };
  let start = 0;
  let prev = smooth(R);
  for (let i = R + 1; i < span; i++) {
    const cur = smooth(i);
    if (prev < 0 && cur >= 0) {
      start = i;
      break;
    }
    prev = cur;
  }
  const step = span / WAVE_POINTS;
  for (let i = 0; i < WAVE_POINTS; i++)
    out[i] = ((bytes[start + Math.floor(i * step)] ?? 128) - 128) / 128;
  return out;
}

// Smoothing that depends on elapsed time, not on how often it runs: the preview runs at the
// display's rate, the render at 30 fps, and both settle on the same envelope. Bands rise fast
// (30 ms) and fall slowly (180 ms).
export const ATTACK_S = 0.03;
export const RELEASE_S = 0.18;
export function smoothBands(
  prev: Float32Array | null,
  next: Float32Array,
  dt: number,
): Float32Array {
  if (!prev || prev.length !== next.length) return Float32Array.from(next);
  const up = 1 - Math.exp(-Math.max(0, dt) / ATTACK_S);
  const down = 1 - Math.exp(-Math.max(0, dt) / RELEASE_S);
  const out = new Float32Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const p = prev[i] as number;
    const n = next[i] as number;
    out[i] = p + (n - p) * (n > p ? up : down);
  }
  return out;
}

// Bass energy, 0..1: what pulses the cover ring, the particles and the play badge.
export function levelOf(bands: ArrayLike<number>): number {
  let sum = 0;
  const n = 8;
  for (let i = 0; i < n; i++) sum += bands[i] ?? 0;
  const mean = sum / n;
  return Math.min(1, Math.max(0, (mean - 0.25) / 0.6));
}

// One analysed video frame.
export type AnalysisFrame = { bands: Float32Array; wave: Float32Array };

// The render's analysis of a whole song: frame f is the analyser read at f / fps seconds,
// smoothed in order. Stored as bytes: BAND_COUNT band values then WAVE_POINTS wave values per
// frame (bands 0..255, wave 0..255 around 128).
export const FRAME_BYTES = BAND_COUNT + WAVE_POINTS;
export function analyseSong(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
  frames: number,
): Uint8Array {
  const out = new Uint8Array(frames * FRAME_BYTES);
  let smoothed: Float32Array | null = null;
  for (let f = 0; f < frames; f++) {
    const end = Math.round((f / fps) * sampleRate);
    const bands = bandsFromBytes(frequencyBytes(samples, end), sampleRate);
    smoothed = smoothBands(smoothed, bands, 1 / fps);
    const wave = waveFromBytes(timeBytes(samples, end));
    const base = f * FRAME_BYTES;
    for (let i = 0; i < BAND_COUNT; i++)
      out[base + i] = Math.round((smoothed[i] as number) * 255);
    for (let i = 0; i < WAVE_POINTS; i++)
      out[base + BAND_COUNT + i] = Math.max(
        0,
        Math.min(255, Math.round((wave[i] as number) * 128 + 128)),
      );
  }
  return out;
}

export function frameOf(data: Uint8Array, frame: number): AnalysisFrame {
  const count = Math.floor(data.length / FRAME_BYTES);
  const f = Math.max(0, Math.min(count - 1, frame));
  const base = f * FRAME_BYTES;
  const bands = new Float32Array(BAND_COUNT);
  const wave = new Float32Array(WAVE_POINTS);
  if (count === 0) return { bands, wave };
  for (let i = 0; i < BAND_COUNT; i++)
    bands[i] = (data[base + i] as number) / 255;
  for (let i = 0; i < WAVE_POINTS; i++)
    wave[i] = ((data[base + BAND_COUNT + i] as number) - 128) / 128;
  return { bands, wave };
}

export function silentFrame(): AnalysisFrame {
  return {
    bands: new Float32Array(BAND_COUNT),
    wave: new Float32Array(WAVE_POINTS),
  };
}

// How many video frames back a frame can look (the trails, peak caps and contour rings of the
// catalogue looks): 36 frames, 1.2 s at 30 fps.
export const HISTORY_FRAMES = 36;

// The render's history for `frame`: frame, frame-1, ... back to frame 0 or HISTORY_FRAMES.
export function historyOf(
  data: Uint8Array,
  frame: number,
  count = HISTORY_FRAMES,
): AnalysisFrame[] {
  const out: AnalysisFrame[] = [];
  for (let k = 0; k < Math.min(count, Math.max(0, frame) + 1); k++)
    out.push(frameOf(data, frame - k));
  return out;
}

// The preview's history: every frame it read, with the song time it was read at. It answers
// with one frame per video frame (1/30 s) back from a time, the read nearest each step, so a
// 60 or 144 Hz screen trails the audio exactly as the 30 fps render does. A seek starts it again.
export function createAudioHistory(fps = 30) {
  let reads: { time: number; frame: AnalysisFrame }[] = [];
  return {
    push(time: number, frame: AnalysisFrame): void {
      const last = reads[reads.length - 1];
      if (last && (time < last.time - 0.05 || time > last.time + 0.5))
        reads = [];
      reads.push({ time, frame });
      const keep = time - (HISTORY_FRAMES + 2) / fps;
      while (reads.length > 2 && (reads[0] as { time: number }).time < keep)
        reads.shift();
    },
    frames(time: number): AnalysisFrame[] {
      const out: AnalysisFrame[] = [];
      if (reads.length === 0) return out;
      const first = (reads[0] as { time: number }).time;
      let at = reads.length - 1;
      for (let k = 0; k < HISTORY_FRAMES; k++) {
        const target = time - k / fps;
        if (target < first - 0.5 / fps) break;
        while (
          at > 0 &&
          Math.abs((reads[at - 1] as { time: number }).time - target) <=
            Math.abs((reads[at] as { time: number }).time - target)
        )
          at--;
        out.push((reads[at] as { frame: AnalysisFrame }).frame);
      }
      return out;
    },
    clear(): void {
      reads = [];
    },
  };
}
export type AudioHistory = ReturnType<typeof createAudioHistory>;
