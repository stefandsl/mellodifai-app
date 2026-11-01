import { describe, expect, it } from "vitest";

import {
  clampParams,
  computePeaks,
  defaultParams,
  type EditParams,
  encodeWav,
  envelopeAt,
  formatClock,
  isUnchanged,
  NORMALIZE_PEAK,
  normalizeGain,
  parseClock,
  peakOf,
  renderEdit,
} from "./audio-edit";

const params = (patch: Partial<EditParams> = {}): EditParams => ({
  ...defaultParams(10),
  ...patch,
});
// 10 samples per second keeps the arithmetic readable.
const RATE = 10;
const flat = (n: number, value = 0.5) =>
  Float32Array.from({ length: n }, () => value);

describe("clampParams", () => {
  it("keeps the kept part inside the file and at least a second long", () => {
    expect(clampParams(params({ start: -3, end: 50 }), 10)).toMatchObject({
      start: 0,
      end: 10,
    });
    expect(clampParams(params({ start: 9.8, end: 9.9 }), 10)).toMatchObject({
      start: 9,
      end: 10,
    });
    expect(clampParams(params({ start: 4, end: 4.2 }), 10)).toMatchObject({
      start: 4,
      end: 5,
    });
    // A file shorter than a second keeps all of it.
    expect(clampParams(params({ start: 0.2, end: 0.3 }), 0.5)).toMatchObject({
      start: 0,
      end: 0.5,
    });
    expect(clampParams(params({ start: Number.NaN }), 10).start).toBe(0);
  });

  it("keeps the other edge where it is while one edge moves", () => {
    // The start dragged past the end stops a second before it.
    expect(
      clampParams(params({ start: 9, end: 6.5 }), 10, "start"),
    ).toMatchObject({ start: 5.5, end: 6.5 });
    // The end dragged before the start stops a second after it.
    expect(clampParams(params({ start: 3, end: 1 }), 10, "end")).toMatchObject({
      start: 3,
      end: 4,
    });
    expect(
      clampParams(params({ start: -1, end: 50 }), 10, "start"),
    ).toMatchObject({ start: 0, end: 10 });
  });

  it("limits the fades to ten seconds and never lets them overlap", () => {
    expect(clampParams({ ...defaultParams(60), fadeIn: 30 }, 60).fadeIn).toBe(
      10,
    );
    const short = clampParams(params({ end: 4, fadeIn: 3, fadeOut: 3 }), 10);
    expect(short.fadeIn).toBe(3);
    expect(short.fadeOut).toBe(1);
    expect(clampParams(params({ fadeIn: -1 }), 10).fadeIn).toBe(0);
  });
});

it("knows an untouched edit", () => {
  expect(isUnchanged(defaultParams(10), 10)).toBe(true);
  expect(isUnchanged(params({ normalize: true }), 10)).toBe(false);
  expect(isUnchanged(params({ end: 9.5 }), 10)).toBe(false);
  expect(isUnchanged(params({ start: 0.5 }), 10)).toBe(false);
  expect(isUnchanged(params({ fadeIn: 1 }), 10)).toBe(false);
  expect(isUnchanged(params({ fadeOut: 1 }), 10)).toBe(false);
});

it("ramps up over the fade in and down over the fade out", () => {
  const p = params({ start: 2, end: 8, fadeIn: 2, fadeOut: 1 });
  expect(envelopeAt(0, p)).toBe(0);
  expect(envelopeAt(1, p)).toBe(0.5);
  expect(envelopeAt(3, p)).toBe(1);
  expect(envelopeAt(5.5, p)).toBe(0.5);
  expect(envelopeAt(6, p)).toBe(0);
  expect(envelopeAt(3, params())).toBe(1);
});

describe("renderEdit", () => {
  it("keeps only the kept part, with the fades applied to every channel", () => {
    const left = Float32Array.from({ length: 100 }, (_, i) => i / 100);
    const out = renderEdit(
      [left, flat(100, -0.5)],
      RATE,
      params({ start: 2, end: 6, fadeIn: 1 }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(40);
    // The first kept sample is silent; after the one-second fade it is untouched.
    expect(out[0]?.[0]).toBe(0);
    expect(out[0]?.[10]).toBeCloseTo(0.3);
    expect(out[1]?.[5]).toBeCloseTo(-0.25);
    expect(out[1]?.[39]).toBeCloseTo(-0.5);
  });

  it("normalises the kept part so its peak reaches -1 dB", () => {
    const channel = flat(100, 0.25);
    channel[3] = 0.9; // outside the kept part: it does not count
    channel[50] = -0.5;
    const p = params({ start: 2.5, end: 9, normalize: true });
    expect(peakOf([channel], RATE, p.start, p.end)).toBe(0.5);
    expect(normalizeGain([channel], RATE, p)).toBeCloseTo(NORMALIZE_PEAK / 0.5);
    const out = renderEdit([channel], RATE, p);
    expect(Math.max(...Array.from(out[0] ?? [], Math.abs))).toBeCloseTo(
      NORMALIZE_PEAK,
    );
    // Silence and normalising switched off leave the level alone.
    expect(
      normalizeGain([flat(100, 0)], RATE, params({ normalize: true })),
    ).toBe(1);
    expect(normalizeGain([channel], RATE, params())).toBe(1);
  });

  it("never writes past full scale", () => {
    const out = renderEdit([flat(20, 1.5)], RATE, params({ end: 2 }));
    expect(out[0]?.[5]).toBe(1);
  });
});

it("computes waveform columns from the loudest sample over all channels", () => {
  const a = Float32Array.from([0, 0.2, 0, 0, -0.8, 0]);
  const b = Float32Array.from([0.4, 0, 0, 0, 0, 0.1]);
  const peaks = Array.from(computePeaks([a, b], 3));
  expect(peaks[0]).toBeCloseTo(0.4);
  expect(peaks[1]).toBe(0);
  expect(peaks[2]).toBeCloseTo(0.8);
  expect(Array.from(computePeaks([], 2))).toEqual([0, 0]);
});

it("writes a 16-bit PCM WAV with interleaved channels", () => {
  const wav = encodeWav(
    [Float32Array.from([1, -1]), Float32Array.from([0, 0.5])],
    44_100,
  );
  const view = new DataView(wav.buffer);
  const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  expect([text(0), text(8), text(12), text(36)]).toEqual([
    "RIFF",
    "WAVE",
    "fmt ",
    "data",
  ]);
  expect(view.getUint32(4, true)).toBe(44);
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(22, true)).toBe(2);
  expect(view.getUint32(24, true)).toBe(44_100);
  expect(view.getUint32(28, true)).toBe(44_100 * 4);
  expect(view.getUint16(32, true)).toBe(4);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getUint32(40, true)).toBe(8);
  expect(wav.byteLength).toBe(52);
  expect([44, 46, 48, 50].map((at) => view.getInt16(at, true))).toEqual([
    32767, 0, -32768, 16384,
  ]);
});

describe("clock text", () => {
  it("formats minutes and seconds, with tenths when asked", () => {
    expect(formatClock(65.34)).toBe("1:05");
    expect(formatClock(65.34, true)).toBe("1:05.3");
    expect(formatClock(59.96, true)).toBe("1:00.0");
    expect(formatClock(-3)).toBe("0:00");
  });
  it("reads it back, also as plain seconds with a comma", () => {
    expect(parseClock("1:05.3")).toBeCloseTo(65.3);
    expect(parseClock(" 65,5 ")).toBe(65.5);
    expect(parseClock("2:00")).toBe(120);
    expect(parseClock("1:75")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("")).toBeNull();
  });
});
