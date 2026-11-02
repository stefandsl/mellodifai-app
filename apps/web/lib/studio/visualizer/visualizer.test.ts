import {
  bandsFromBytes,
  defaultVisualizerParams,
  FFT_SIZE,
  MAX_DB,
  MIN_DB,
  STOCK_BACKGROUNDS,
} from "@mellodifai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { visualizersOf } from "../clips";
import {
  playerAnalyser,
  registerPlayerAudio,
  resetPlayerAudio,
} from "./audio-tap";
import { configureAnalyser, readAnalyser } from "./live-frame";
import { pictureLinks } from "./pictures";
import { uploadProblem } from "./upload";

function fakeAnalyser(sampleRate = 48000) {
  return {
    fftSize: 0,
    smoothingTimeConstant: 1,
    minDecibels: 0,
    maxDecibels: 0,
    frequencyBinCount: FFT_SIZE / 2,
    context: { sampleRate },
    getByteFrequencyData: (out: Uint8Array) => out.fill(200),
    getByteTimeDomainData: (out: Uint8Array) => out.fill(128),
    connect: vi.fn(),
  } as unknown as AnalyserNode;
}

describe("live frame", () => {
  it("sets the analyser up as the render PC reproduces it", () => {
    const analyser = fakeAnalyser();
    configureAnalyser(analyser);
    expect(analyser).toMatchObject({
      fftSize: FFT_SIZE,
      smoothingTimeConstant: 0,
      minDecibels: MIN_DB,
      maxDecibels: MAX_DB,
    });
  });

  it("reads bands with the shared math and smooths them over time", () => {
    const analyser = fakeAnalyser();
    const first = readAnalyser(analyser, null, 1 / 60);
    expect(Array.from(first.bands)).toEqual(
      Array.from(bandsFromBytes(new Uint8Array(FFT_SIZE / 2).fill(200), 48000)),
    );
    expect(first.wave.every((v) => v === 0)).toBe(true);
    const quieter = readAnalyser(
      {
        ...analyser,
        getByteFrequencyData: (out: Uint8Array) => out.fill(0),
        getByteTimeDomainData: (out: Uint8Array) => out.fill(128),
      } as unknown as AnalyserNode,
      first.bands,
      1 / 60,
    );
    // Falls slowly instead of dropping to silence.
    expect(quieter.bands[0]).toBeGreaterThan(0);
    expect(quieter.bands[0]).toBeLessThan(first.bands[0] as number);
  });
});

describe("audio tap", () => {
  afterEach(() => {
    resetPlayerAudio();
    vi.unstubAllGlobals();
  });

  it("connects the player's element to one analyser, once, and reuses it", () => {
    const created: unknown[] = [];
    class FakeContext {
      state = "running";
      destination = {};
      createMediaElementSource(el: unknown) {
        created.push(el);
        return { connect: vi.fn() };
      }
      createAnalyser() {
        return fakeAnalyser();
      }
      resume = vi.fn();
    }
    vi.stubGlobal("AudioContext", FakeContext);
    expect(playerAnalyser()).toBeNull();
    const el = document.createElement("audio");
    registerPlayerAudio(el);
    const first = playerAnalyser();
    const second = playerAnalyser();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(created).toEqual([el]);
  });
});

describe("pictures", () => {
  const cover = "/media/previews/cover.jpg";
  it("draws the stock picture for Casuale and the cover until something is uploaded", () => {
    const params = defaultVisualizerParams();
    expect(pictureLinks(params, cover)).toMatchObject({
      background: `/media/uploads/${STOCK_BACKGROUNDS[0]}`,
      backgroundVideo: null,
      center: cover,
      marks: false,
    });
    params.background = { mode: "image", seed: 0, assetUrl: null, dimming: 60 };
    expect(pictureLinks(params, cover).background).toBe(cover);
    params.background.assetUrl = "/media/uploads/u/a.png";
    expect(pictureLinks(params, cover).background).toBe(
      "/media/uploads/u/a.png",
    );
    params.background = {
      mode: "video",
      seed: 0,
      assetUrl: "/media/uploads/u/v.mp4",
      dimming: 60,
    };
    expect(pictureLinks(params, cover)).toMatchObject({
      background: null,
      backgroundVideo: "/media/uploads/u/v.mp4",
    });
    params.centerImage = { mode: "upload", assetUrl: null, fit: "cover" };
    expect(pictureLinks(params, cover).center).toBe(cover);
    params.centerImage = { mode: "none", assetUrl: null, fit: "cover" };
    expect(pictureLinks(params, cover).center).toBeNull();
    expect(pictureLinks({ ...params, preset: "classico" }, cover).marks).toBe(
      true,
    );
  });
});

describe("uploads", () => {
  it("checks type and size before sending", () => {
    expect(
      uploadProblem({ type: "image/png", size: 10 * 1024 * 1024 }, "image"),
    ).toBeNull();
    expect(
      uploadProblem({ type: "image/png", size: 10 * 1024 * 1024 + 1 }, "image"),
    ).toBe("tooBig");
    expect(uploadProblem({ type: "image/gif", size: 10 }, "image")).toBe(
      "wrongType",
    );
    expect(
      uploadProblem({ type: "video/mp4", size: 100 * 1024 * 1024 }, "video"),
    ).toBeNull();
    expect(
      uploadProblem(
        { type: "video/mp4", size: 100 * 1024 * 1024 + 1 },
        "video",
      ),
    ).toBe("tooBig");
    expect(uploadProblem({ type: "video/quicktime", size: 10 }, "video")).toBe(
      "wrongType",
    );
  });
});

describe("visualizersOf", () => {
  const url = (path: string | null | undefined) =>
    path ? `/media/${path}` : null;
  const row = (over: Record<string, unknown>) => ({
    id: "r1",
    version_id: "v1",
    kind: "visualizer",
    aspect: "16:9" as const,
    preview_path: null,
    visualizer_params: { preset: "mirror" },
    ...over,
  });
  it("reads each render's state from its job, wide first", () => {
    const list = visualizersOf(
      [
        row({ id: "r2", aspect: "9:16" }),
        row({ preview_path: "previews/o/p/it/visualizer-16x9.mp4" }),
      ],
      [
        {
          id: "j1",
          version_id: "v1",
          status: "done",
          error: null,
          started_at: null,
          render_id: "r1",
        },
        {
          id: "j2",
          version_id: "v1",
          status: "queued",
          error: null,
          started_at: null,
          render_id: "r2",
        },
      ],
      [{ version_id: "v1", aspect: "9:16", queue_position: 3 }],
      url,
      "Astri: lounge",
    );
    expect(list.map((v) => v.aspect)).toEqual(["16:9", "9:16"]);
    expect(list[0]).toMatchObject({
      status: "done",
      url: "/media/previews/o/p/it/visualizer-16x9.mp4",
      posterUrl: "/media/previews/o/p/it/visualizer-16x9.jpg",
      downloadUrl: `/media/previews/o/p/it/visualizer-16x9.mp4?download=${encodeURIComponent("Astri lounge - visualizer 16x9.mp4")}`,
    });
    expect(list[0]?.params.preset).toBe("mirror");
    expect(list[1]).toMatchObject({
      status: "queued",
      queuePosition: 3,
      url: null,
    });
  });

  it("reports a failed job with its reason, and keeps the last video", () => {
    const [video] = visualizersOf(
      [row({ preview_path: "previews/x.mp4" })],
      [
        {
          id: "j1",
          version_id: "v1",
          status: "failed",
          error: "boom",
          started_at: null,
          render_id: "r1",
        },
      ],
      [],
      url,
      "T",
    );
    expect(video).toMatchObject({
      status: "failed",
      error: "boom",
      url: "/media/previews/x.mp4",
    });
    expect(visualizersOf([row({ kind: "master" })], [], [], url, "T")).toEqual(
      [],
    );
  });
});
