"use client";

import "@fontsource/oswald/300.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";

import {
  createVisualizerRenderer,
  type Picture,
  silentFrame,
  smoothBands,
  VISUALIZER_FONT,
  type VisualizerParams,
} from "@mellodifai/shared";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";

import { playerAnalyser, playerAudio } from "@/lib/studio/visualizer/audio-tap";
import { readAnalyser } from "@/lib/studio/visualizer/live-frame";
import {
  GRAMOPHONE_URL,
  pictureLinks,
  TRUMPET_URL,
  usePicture,
} from "@/lib/studio/visualizer/pictures";
import { usePlayer } from "@/store/player";

// Longest side of the preview canvas in pixels: sharp on a retina laptop, light enough to draw
// every animation frame with effects on.
const MAX_SIDE = 1280;

type Props = {
  params: VisualizerParams;
  title: string;
  coverUrl: string | null;
  // The song the studio is for; null in setup, where whatever plays drives the preview.
  songId: string | null;
  className?: string;
};

// The live preview: the shared renderer drawing the player's audio as the analyser hears it,
// every animation frame, with the same parameters the render PC will use.
export function VisualizerPreview({
  params,
  title,
  coverUrl,
  songId,
  className,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const links = pictureLinks(params, coverUrl);
  const background = usePicture(links.background);
  const center = usePicture(links.center);
  const trumpet = usePicture(links.marks ? TRUMPET_URL : null);
  const gramophone = usePicture(links.marks ? GRAMOPHONE_URL : null);
  const tall = params.aspect === "9:16";

  // The canvas fills the largest box of the chosen aspect that fits.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const ratio = tall ? 9 / 16 : 16 / 9;
      const width = Math.max(1, Math.floor(Math.min(w, h * ratio)));
      const height = Math.max(1, Math.floor(width / ratio));
      setSize({ width, height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tall]);

  // Everything the animation loop reads, kept current without restarting it.
  const latest = useRef({
    params,
    title,
    songId,
    background,
    center,
    trumpet,
    gramophone,
  });
  latest.current = {
    params,
    title,
    songId,
    background,
    center,
    trumpet,
    gramophone,
  };

  useEffect(() => {
    void Promise.all(
      [300, 500, 600].map((weight) =>
        document.fonts.load(`${weight} 40px "${VISUALIZER_FONT}"`, "AБ"),
      ),
    ).catch(() => {});
    const analyser = playerAnalyser();
    const draw = createVisualizerRenderer((w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    });
    let frame = 0;
    let last = performance.now();
    const started = last;
    let bands: Float32Array | null = null;
    const quiet = silentFrame();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const el = canvas.current;
      const ctx = el?.getContext("2d");
      if (!el || !ctx) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const state = latest.current;
      const audio = playerAudio();
      const player = usePlayer.getState();
      const current = player.queue[player.index]?.id;
      // The song's own playback drives the frame; in setup any song does.
      const live =
        Boolean(audio) &&
        Boolean(current) &&
        (state.songId === null || current === state.songId);
      const time = live && audio ? audio.currentTime : (now - started) / 1000;
      const duration =
        live && audio && Number.isFinite(audio.duration) ? audio.duration : 180;
      let wave = quiet.wave;
      if (live && analyser && audio && !audio.paused) {
        const read = readAnalyser(analyser, bands, dt);
        bands = read.bands;
        wave = read.wave;
      } else bands = smoothBands(bands, quiet.bands, dt);
      // A background video loops in step with the song.
      const v = video.current;
      let backdrop: Picture | null = state.background;
      if (v && v.readyState >= 2 && v.videoWidth) {
        const target =
          Number.isFinite(v.duration) && v.duration > 0 ? time % v.duration : 0;
        if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
        if (live && audio && !audio.paused) {
          if (v.paused) void v.play().catch(() => {});
        } else if (!v.paused) v.pause();
        backdrop = { source: v, width: v.videoWidth, height: v.videoHeight };
      }
      draw(ctx, {
        params: state.params,
        width: el.width,
        height: el.height,
        time,
        duration,
        bands,
        wave,
        title: state.title,
        fontFamily: VISUALIZER_FONT,
        images: {
          background: backdrop,
          center: state.center,
          trumpet: state.trumpet,
          gramophone: state.gramophone,
        },
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const scale = Math.min(
    2,
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  );
  const long = Math.max(size.width, size.height) * scale;
  const factor = long > MAX_SIDE ? MAX_SIDE / long : 1;
  return (
    <div
      ref={box}
      className={cn(
        "flex min-h-0 min-w-0 items-center justify-center",
        className,
      )}
    >
      {links.backgroundVideo ? (
        <video
          ref={video}
          src={links.backgroundVideo}
          crossOrigin="anonymous"
          muted
          loop
          playsInline
          preload="auto"
          className="hidden"
        />
      ) : null}
      <canvas
        ref={canvas}
        data-testid="visualizer-preview"
        data-preset={params.preset}
        data-aspect={params.aspect}
        width={Math.max(1, Math.round(size.width * scale * factor))}
        height={Math.max(1, Math.round(size.height * scale * factor))}
        style={{ width: size.width, height: size.height }}
        className="rounded-xl bg-black shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
      />
    </div>
  );
}
