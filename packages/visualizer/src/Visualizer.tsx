import "@fontsource/oswald/300.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";

import {
  createVisualizerRenderer,
  frameOf,
  historyOf,
  normalizeVisualizerParams,
  type Picture,
  silentFrame,
  VISUALIZER_FONT,
  type VisualizerParams,
  withFocus,
} from "@mellodifai/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  Loop,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Files are names inside the render's public folder, which the worker fills per job
// (apps/worker/src/stages/visualizer.ts).
export type VisualizerProps = {
  params: VisualizerParams;
  title: string;
  // Song length in seconds and in frames.
  duration: number;
  frames: number;
  audio: string | null;
  // analyseSong() bytes (packages/shared/src/visualizer/audio.ts).
  analysis: string | null;
  // A video background loops every `frames` frames.
  background: { file: string; kind: "image" | "video"; frames?: number } | null;
  center: string | null;
  // The user's logos, one per entry of params.logos; null for one whose file is missing.
  logos?: (string | null)[];
};

type Loaded = {
  analysis: Uint8Array | null;
  background: Picture | null;
  center: Picture | null;
  logos: (Picture | null)[];
};

function scratchCanvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

// `subject`: also read where the subject sits (the centre picture's square crop follows it, as
// in the preview).
async function picture(
  file: string | null,
  subject = false,
): Promise<Picture | null> {
  if (!file) return null;
  const img = new Image();
  img.src = staticFile(file);
  await img.decode();
  const pic: Picture = {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
  return subject ? withFocus(pic, scratchCanvas) : pic;
}

// A logo that cannot be read is left out of the frames, not a failed render.
function logoPicture(file: string | null): Promise<Picture | null> {
  return picture(file).catch(() => null);
}

// Everything the frames need, loaded once before the first frame is taken.
function useLoaded(props: VisualizerProps): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [handle] = useState(() => delayRender("Visualizer assets"));
  const { analysis: analysisFile, background: bg, center } = props;
  const bgImage = bg?.kind === "image" ? bg.file : null;
  // One string, so a new props object with the same logos does not load them again.
  const logoFiles = JSON.stringify(props.logos ?? []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [analysis, background, centerPic, logos] = await Promise.all([
        analysisFile
          ? fetch(staticFile(analysisFile))
              .then((r) => r.arrayBuffer())
              .then((b) => new Uint8Array(b))
          : null,
        picture(bgImage),
        picture(center, true),
        Promise.all(
          (JSON.parse(logoFiles) as (string | null)[]).map(logoPicture),
        ),
        ...[300, 500, 600].map((weight) =>
          document.fonts.load(`${weight} 40px "${VISUALIZER_FONT}"`, "AБ"),
        ),
      ]);
      if (!alive) return;
      setLoaded({
        analysis,
        background,
        center: centerPic,
        logos,
      });
      continueRender(handle);
    })().catch((error) => cancelRender(error));
    return () => {
      alive = false;
    };
  }, [analysisFile, bgImage, center, logoFiles, handle]);
  return loaded;
}

export function Visualizer(props: VisualizerProps) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const params = useMemo(
    () => normalizeVisualizerParams(props.params),
    [props.params],
  );
  const loaded = useLoaded(props);
  const canvas = useRef<HTMLCanvasElement>(null);
  const videoFrame = useRef<Picture | null>(null);
  const draw = useMemo(
    () =>
      createVisualizerRenderer((w, h) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return c;
      }),
    [],
  );
  const paint = useCallback(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !loaded) return;
    const audio = loaded.analysis
      ? frameOf(loaded.analysis, frame)
      : silentFrame();
    draw(ctx, {
      params,
      width,
      height,
      time: frame / fps,
      duration: props.duration,
      bands: audio.bands,
      wave: audio.wave,
      // The frames before this one, for the looks that trail the music.
      history: loaded.analysis ? historyOf(loaded.analysis, frame) : [],
      title: props.title,
      fontFamily: VISUALIZER_FONT,
      images: {
        background:
          props.background?.kind === "video"
            ? videoFrame.current
            : loaded.background,
        center: loaded.center,
        logos: loaded.logos,
      },
    });
  }, [loaded, frame, draw, params, width, height, fps, props]);

  useEffect(() => {
    paint();
  }, [paint]);

  const bg = props.background;
  return (
    <AbsoluteFill style={{ backgroundColor: "#06060b" }}>
      {props.audio ? <Audio src={staticFile(props.audio)} /> : null}
      {bg?.kind === "video" ? (
        <Loop durationInFrames={Math.max(1, bg.frames ?? props.frames)}>
          <OffthreadVideo
            src={staticFile(bg.file)}
            muted
            style={{ opacity: 0 }}
            onVideoFrame={(source) => {
              const s = source as { width?: number; height?: number };
              videoFrame.current = {
                source,
                width: s.width ?? width,
                height: s.height ?? height,
              };
              paint();
            }}
          />
        </Loop>
      ) : null}
      <canvas
        ref={canvas}
        width={width}
        height={height}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
    </AbsoluteFill>
  );
}
