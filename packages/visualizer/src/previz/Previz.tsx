import type { Shot } from "@mellodifai/shared";
import { useLayoutEffect, useMemo, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { poseAtFrame, trackForShot } from "./camera";
import { drawScene } from "./raster";
import { sceneAt } from "./scene";

export type PrevizWord = {
  text: string;
  // Seconds from the start of the shot.
  start: number;
  end: number;
  line: number;
};

// One shot of the previz: the grey-box stage seen through the shot's camera, a label naming the
// shot and the lyrics it carries. The worker's music-video plan writes these props per segment.
export type PrevizProps = {
  shot: Shot;
  frames: number;
  // Beat times in seconds from the start of the shot.
  beats: number[];
  words: PrevizWord[];
};

export function currentLine(words: PrevizWord[], time: number): string {
  const sounding = words.find((w) => w.start <= time && time < w.end);
  const last = [...words].reverse().find((w) => w.start <= time);
  const line =
    sounding?.line ?? (last && time - last.end < 1.5 ? last.line : null);
  if (line === null) return "";
  return words
    .filter((w) => w.line === line)
    .map((w) => w.text)
    .join(" ");
}

function hud(
  ctx: CanvasRenderingContext2D,
  props: PrevizProps,
  cut: number,
  time: number,
  width: number,
  height: number,
) {
  const s = height / 720;
  const { shot } = props;
  const label = [
    `SEG ${String(shot.segment + 1).padStart(2, "0")}`,
    shot.kind,
    shot.kind === "burst"
      ? `cut ${cut + 1}/${shot.burst.length} ${shot.burst[cut]}`
      : shot.camera,
    shot.section,
    `${shot.set} / ${shot.costume}`,
  ].join("  |  ");
  ctx.font = `600 ${Math.round(18 * s)}px Arial, sans-serif`;
  ctx.textBaseline = "top";
  const pad = 10 * s;
  const w = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(16 * s, 16 * s, w + pad * 2, 30 * s);
  ctx.fillStyle = "#f2efe8";
  ctx.fillText(label, 16 * s + pad, 22 * s);
  const line = currentLine(props.words, time);
  if (line) {
    ctx.font = `500 ${Math.round(28 * s)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const lw = Math.min(width - 80 * s, ctx.measureText(line).width);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(
      (width - lw) / 2 - pad * 2,
      height - 76 * s,
      lw + pad * 4,
      48 * s,
    );
    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, width / 2, height - 38 * s, width - 80 * s);
    ctx.textAlign = "left";
  }
}

export function Previz(props: PrevizProps) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const track = useMemo(() => trackForShot(props.shot), [props.shot]);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const time = frame / fps;
    const pose = poseAtFrame(track, frame, props.frames);
    const singing = props.words.some((w) => w.start <= time && time < w.end);
    const boxes = sceneAt({
      set: props.shot.set,
      time,
      beats: props.beats,
      singing,
    });
    drawScene(ctx, boxes, pose, width, height);
    hud(ctx, props, pose.cut, time, width, height);
  }, [frame, fps, track, props, width, height]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#101116" }}>
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
