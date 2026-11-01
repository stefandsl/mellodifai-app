import { describe, expect, it, vi } from "vitest";

import { encodeMp3, MP3_BITRATE, toStereo } from "./mp3";

// An encoder that records what it was given and returns its own reused buffer, as the
// WebAssembly one does.
function fakeEncoder() {
  const shared = new Uint8Array(4);
  const calls: { frames: number; channels: number }[] = [];
  const configure = vi.fn();
  let n = 0;
  return {
    calls,
    configure,
    create: async () => ({
      configure,
      encode: (samples: readonly Float32Array[]) => {
        calls.push({
          frames: samples[0]?.length ?? 0,
          channels: samples.length,
        });
        shared.fill(++n);
        return shared;
      },
      finalize: () => {
        shared.fill(99);
        return shared;
      },
    }),
  };
}

describe("encodeMp3", () => {
  it("encodes in slices at 320 kbps, copying each piece and reporting progress", async () => {
    const fake = fakeEncoder();
    const frames = 1152 * 56 * 2 + 10;
    const progress: number[] = [];
    const blob = await encodeMp3(
      [new Float32Array(frames), new Float32Array(frames)],
      48_000,
      { createEncoder: fake.create, onProgress: (f) => progress.push(f) },
    );
    expect(fake.configure).toHaveBeenCalledWith({
      channels: 2,
      sampleRate: 48_000,
      bitrate: MP3_BITRATE,
    });
    expect(fake.calls.map((call) => call.frames)).toEqual([
      1152 * 56,
      1152 * 56,
      10,
    ]);
    expect(blob.type).toBe("audio/mpeg");
    // Each piece kept its own bytes although the encoder reuses one buffer.
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 99, 99, 99, 99,
    ]);
    expect(progress.at(-1)).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it("stops when cancelled", async () => {
    const fake = fakeEncoder();
    const controller = new AbortController();
    controller.abort();
    await expect(
      encodeMp3([new Float32Array(10)], 44_100, {
        createEncoder: fake.create,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fake.configure).toHaveBeenCalledWith(
      expect.objectContaining({ channels: 1 }),
    );
  });

  it("produces real MP3 frames with the WebAssembly encoder", async () => {
    const second = Float32Array.from(
      { length: 44_100 },
      (_, i) => Math.sin((i / 44_100) * 2 * Math.PI * 440) * 0.5,
    );
    const blob = await encodeMp3([second, second], 44_100);
    const data = new Uint8Array(await blob.arrayBuffer());
    // About one second at 320 kbps, starting with an MPEG frame sync.
    expect(data.byteLength).toBeGreaterThan(30_000);
    expect(data.byteLength).toBeLessThan(60_000);
    const sync = data.findIndex(
      (byte, i) => byte === 0xff && ((data[i + 1] ?? 0) & 0xe0) === 0xe0,
    );
    expect(sync).toBeGreaterThanOrEqual(0);
  });
});

it("folds more than two channels into stereo and leaves stereo alone", () => {
  const mono = [Float32Array.from([1])];
  expect(toStereo(mono)).toEqual(mono);
  const [left, right] = toStereo([
    Float32Array.from([1]),
    Float32Array.from([0.5]),
    Float32Array.from([0]),
    Float32Array.from([0.5]),
  ]);
  expect(left?.[0]).toBeCloseTo(0.5);
  expect(right?.[0]).toBeCloseTo(0.5);
});
