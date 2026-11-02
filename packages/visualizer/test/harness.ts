// The preview side of the frame comparison, run in Chrome: the same samples played through a
// real Web Audio AnalyserNode, read with the studio's own code (apps/web live-frame.ts), drawn
// with the shared renderer, as the Video Studio preview does.
import {
  ANALYSIS_RATE,
  type AnalysisFrame,
  createAudioHistory,
  createVisualizerRenderer,
  normalizeVisualizerParams,
  type Picture,
  VISUALIZER_FONT,
  withFocus,
} from "@mellodifai/shared";
import {
  configureAnalyser,
  readAnalyser,
} from "../../../apps/web/lib/studio/visualizer/live-frame";
import { testSignal } from "./signal";

type Job = {
  params: unknown;
  frame: number;
  width: number;
  height: number;
  title: string;
  duration: number;
};

async function picture(src: string, subject = false): Promise<Picture> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const pic: Picture = {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
  return subject
    ? withFocus(pic, (w, h) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return c;
      })
    : pic;
}

async function previewFrame(
  job: Job,
  files: Record<string, string>,
): Promise<string> {
  for (const [weight, url] of Object.entries(
    files.fonts ? JSON.parse(files.fonts) : {},
  )) {
    const face = new FontFace(VISUALIZER_FONT, `url(${url})`, { weight });
    document.fonts.add(await face.load());
  }
  const samples = testSignal();
  const ctx = new OfflineAudioContext(1, samples.length, ANALYSIS_RATE);
  const buffer = ctx.createBuffer(1, samples.length, ANALYSIS_RATE);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const analyser = ctx.createAnalyser();
  configureAnalyser(analyser);
  source.connect(analyser);
  analyser.connect(ctx.destination);
  // Read the analyser at every video frame up to the one compared, as the render does.
  // The studio keeps the frames it read in the same history the preview uses.
  let bands: Float32Array | null = null;
  let wave: Float32Array = new Float32Array(0);
  const history = createAudioHistory();
  for (let f = 0; f <= job.frame; f++) {
    const at = f / 30;
    void ctx.suspend(at).then(() => {
      const read = readAnalyser(analyser, bands, 1 / 30);
      bands = read.bands;
      wave = read.wave;
      history.push(at, read as AnalysisFrame);
      void ctx.resume();
    });
  }
  source.start();
  const done = new Promise<void>((resolve) => {
    void ctx.suspend((job.frame + 1) / 30).then(() => resolve());
  });
  void ctx.startRendering();
  await done;
  const canvas = document.createElement("canvas");
  canvas.width = job.width;
  canvas.height = job.height;
  const draw = createVisualizerRenderer((w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  });
  const [background, center] = await Promise.all(
    [files.background, files.center].map((src, i) =>
      picture(src as string, i === 1),
    ),
  );
  const logos = await Promise.all(
    (JSON.parse(files.logos ?? "[]") as string[]).map((src) => picture(src)),
  );
  draw(canvas.getContext("2d") as CanvasRenderingContext2D, {
    params: normalizeVisualizerParams(job.params),
    width: job.width,
    height: job.height,
    time: job.frame / 30,
    duration: job.duration,
    bands: bands ?? new Float32Array(64),
    wave,
    history: history.frames(job.frame / 30),
    title: job.title,
    fontFamily: VISUALIZER_FONT,
    images: {
      background: background ?? null,
      center: center ?? null,
      logos,
    },
  });
  return canvas.toDataURL("image/png");
}

// Mean absolute difference per channel (0..255) and the share of pixels off by more than 48.
async function compare(
  a: string,
  b: string,
): Promise<{ mean: number; far: number }> {
  const [x, y] = await Promise.all([picture(a), picture(b)]);
  const read = (p: Picture) => {
    const c = document.createElement("canvas");
    c.width = x.width;
    c.height = x.height;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    g.drawImage(p.source as HTMLImageElement, 0, 0, x.width, x.height);
    return g.getImageData(0, 0, x.width, x.height).data;
  };
  const da = read(x);
  const db = read(y);
  let sum = 0;
  let far = 0;
  for (let i = 0; i < da.length; i += 4) {
    let px = 0;
    for (let k = 0; k < 3; k++) {
      const d = Math.abs((da[i + k] as number) - (db[i + k] as number));
      sum += d;
      px = Math.max(px, d);
    }
    if (px > 48) far++;
  }
  return { mean: sum / ((da.length / 4) * 3), far: far / (da.length / 4) };
}

Object.assign(window, { previewFrame, compare });
