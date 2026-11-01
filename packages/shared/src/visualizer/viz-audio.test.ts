import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RATE,
  analyseSong,
  BAND_COUNT,
  bandEdges,
  bandsFromBytes,
  blackman,
  FFT_SIZE,
  FRAME_BYTES,
  fft,
  frameOf,
  frequencyBytes,
  levelOf,
  MAX_DB,
  MIN_DB,
  smoothBands,
  timeBytes,
  WAVE_POINTS,
  waveFromBytes,
} from "./viz-audio.js";

function sine(hz: number, seconds: number, amp = 0.5, rate = ANALYSIS_RATE) {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++)
    out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

describe("analysis like the Web Audio analyser", () => {
  it("computes the same FFT as a plain DFT", () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++)
      re[i] = Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1);
    const input = Float64Array.from(re);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        sr += (input[t] as number) * Math.cos((-2 * Math.PI * k * t) / n);
        si += (input[t] as number) * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(sr, 9);
      expect(im[k]).toBeCloseTo(si, 9);
    }
  });

  it("uses the Blackman window of the specification", () => {
    const w = blackman();
    expect(w).toHaveLength(FFT_SIZE);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[FFT_SIZE / 2]).toBeCloseTo(1, 12);
  });

  it("peaks the frequency bytes at a sine's bin and leaves silence at zero", () => {
    const hz = 1000;
    const samples = sine(hz, 1);
    const bytes = frequencyBytes(samples, samples.length);
    expect(bytes).toHaveLength(FFT_SIZE / 2);
    let best = 0;
    for (let k = 1; k < bytes.length; k++)
      if ((bytes[k] as number) > (bytes[best] as number)) best = k;
    expect(
      Math.abs(best - (hz * FFT_SIZE) / ANALYSIS_RATE),
    ).toBeLessThanOrEqual(1);
    // amplitude 0.5 through the window: |X|/N = 0.5 * 0.42 / 2 = 0.105 -> -19.6 dB, above
    // MAX_DB, so the byte saturates as getByteFrequencyData does.
    expect(bytes[best]).toBe(255);
    const silent = frequencyBytes(new Float32Array(4096), 4096);
    expect(Math.max(...silent)).toBe(0);
  });

  it("maps decibels to bytes between MIN_DB and MAX_DB", () => {
    // A quiet sine lands inside the range: -60 dB relative magnitude.
    const amp = 10 ** (-60 / 20) / (0.42 / 2);
    const samples = sine(1500, 1, amp);
    const bytes = frequencyBytes(samples, samples.length);
    const peak = Math.max(...bytes);
    const expected = Math.floor((255 / (MAX_DB - MIN_DB)) * (-60 - MIN_DB));
    expect(Math.abs(peak - expected)).toBeLessThanOrEqual(3);
  });

  it("reads time bytes around 128", () => {
    const bytes = timeBytes(new Float32Array([0, 0.5, -0.5, 1]), 4);
    expect(bytes).toHaveLength(FFT_SIZE);
    expect(Array.from(bytes.slice(-4))).toEqual([128, 192, 64, 255]);
    expect(bytes[0]).toBe(128);
    const wave = waveFromBytes(bytes);
    expect(wave).toHaveLength(WAVE_POINTS);
    expect(wave[0]).toBe(0);
  });

  it("splits the bins into 64 rising bands that each own a bin", () => {
    for (const rate of [44100, 48000]) {
      const edges = bandEdges(rate);
      expect(edges).toHaveLength(BAND_COUNT + 1);
      for (let i = 1; i < edges.length; i++)
        expect(edges[i] as number).toBeGreaterThan(edges[i - 1] as number);
    }
    const low = bandsFromBytes(
      frequencyBytes(sine(60, 1), ANALYSIS_RATE),
      ANALYSIS_RATE,
    );
    const high = bandsFromBytes(
      frequencyBytes(sine(8000, 1), ANALYSIS_RATE),
      ANALYSIS_RATE,
    );
    const argmax = (a: Float32Array) => a.indexOf(Math.max(...a));
    expect(argmax(low)).toBeLessThan(10);
    expect(argmax(high)).toBeGreaterThan(45);
    expect(levelOf(low)).toBeGreaterThan(levelOf(high));
  });

  it("smooths by elapsed time, so 60 and 30 frames a second settle alike", () => {
    const target = new Float32Array(BAND_COUNT).fill(1);
    let at60: Float32Array = new Float32Array(BAND_COUNT);
    let at30: Float32Array = new Float32Array(BAND_COUNT);
    for (let i = 0; i < 6; i++) at60 = smoothBands(at60, target, 1 / 60);
    for (let i = 0; i < 3; i++) at30 = smoothBands(at30, target, 1 / 30);
    expect(at60[0]).toBeCloseTo(at30[0] as number, 6);
    // It rises fast and falls slowly.
    const up = smoothBands(
      new Float32Array([0]),
      new Float32Array([1]),
      0.03,
    )[0] as number;
    const down = smoothBands(
      new Float32Array([1]),
      new Float32Array([0]),
      0.03,
    )[0] as number;
    expect(up).toBeGreaterThan(1 - down);
  });

  it("stores one frame per video frame and reads it back", () => {
    const samples = sine(220, 2);
    const data = analyseSong(samples, ANALYSIS_RATE, 30, 60);
    expect(data).toHaveLength(60 * FRAME_BYTES);
    const frame = frameOf(data, 45);
    expect(frame.bands).toHaveLength(BAND_COUNT);
    expect(frame.wave).toHaveLength(WAVE_POINTS);
    expect(Math.max(...frame.bands)).toBeGreaterThan(0.5);
    // Out-of-range frames clamp to the last one.
    expect(frameOf(data, 999).bands).toEqual(frameOf(data, 59).bands);
  });
});
