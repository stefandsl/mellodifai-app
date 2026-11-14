// The previz camera DSL: path, orbit, dolly, push and lookAt moves, a preset per shot-list
// camera, and a track per shot (one move, or five cuts for a burst). Everything is a pure
// function of the frame number, so a frame renders the same on every run.
import type { Camera, Shot } from "@mellodifai/shared";

export type Vec3 = readonly [number, number, number];
export type CameraPose = { eye: Vec3; target: Vec3; fov: number };

export type CameraMove =
  | { op: "lookAt"; eye: Vec3; target: Vec3; fov: number }
  | { op: "path"; points: Vec3[]; target: Vec3; fov: number }
  | {
      op: "orbit";
      center: Vec3;
      radius: number;
      height: number;
      fromDeg: number;
      toDeg: number;
      target: Vec3;
      fov: number;
    }
  | { op: "dolly"; from: Vec3; to: Vec3; target: Vec3; fov: number }
  | {
      op: "push";
      target: Vec3;
      // From the target toward the camera.
      direction: Vec3;
      fromDist: number;
      toDist: number;
      fov: number;
    };

export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const scale = (a: Vec3, k: number): Vec3 => [
  a[0] * k,
  a[1] * k,
  a[2] * k,
];
export const dot = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 1];
};
const lerp = (a: Vec3, b: Vec3, u: number): Vec3 => add(a, scale(sub(b, a), u));
// Moves start and stop gently, as a camera operator would.
export const ease = (u: number) => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
};

// The DSL: cam.orbit(...), cam.push(...), and so on, each returning a move.
export const cam = {
  lookAt: (eye: Vec3, target: Vec3, fov = 40): CameraMove => ({
    op: "lookAt",
    eye,
    target,
    fov,
  }),
  path: (points: Vec3[], target: Vec3, fov = 40): CameraMove => ({
    op: "path",
    points,
    target,
    fov,
  }),
  orbit: (
    center: Vec3,
    radius: number,
    height: number,
    fromDeg: number,
    toDeg: number,
    target: Vec3,
    fov = 40,
  ): CameraMove => ({
    op: "orbit",
    center,
    radius,
    height,
    fromDeg,
    toDeg,
    target,
    fov,
  }),
  dolly: (from: Vec3, to: Vec3, target: Vec3, fov = 40): CameraMove => ({
    op: "dolly",
    from,
    to,
    target,
    fov,
  }),
  push: (
    target: Vec3,
    direction: Vec3,
    fromDist: number,
    toDist: number,
    fov = 40,
  ): CameraMove => ({
    op: "push",
    target,
    direction: normalize(direction),
    fromDist,
    toDist,
    fov,
  }),
};

// Where the camera is `u` (0..1) of the way through a move.
export function poseOf(move: CameraMove, u: number): CameraPose {
  const t = ease(u);
  switch (move.op) {
    case "lookAt":
      return { eye: move.eye, target: move.target, fov: move.fov };
    case "path": {
      const n = move.points.length - 1;
      if (n <= 0)
        return {
          eye: move.points[0] ?? [0, 2, 10],
          target: move.target,
          fov: move.fov,
        };
      const x = t * n;
      const i = Math.min(n - 1, Math.floor(x));
      return {
        eye: lerp(move.points[i] as Vec3, move.points[i + 1] as Vec3, x - i),
        target: move.target,
        fov: move.fov,
      };
    }
    case "orbit": {
      const deg = move.fromDeg + (move.toDeg - move.fromDeg) * t;
      const a = (deg * Math.PI) / 180;
      return {
        eye: [
          move.center[0] + Math.sin(a) * move.radius,
          move.height,
          move.center[2] + Math.cos(a) * move.radius,
        ],
        target: move.target,
        fov: move.fov,
      };
    }
    case "dolly":
      return {
        eye: lerp(move.from, move.to, t),
        target: move.target,
        fov: move.fov,
      };
    case "push": {
      const d = move.fromDist + (move.toDist - move.fromDist) * t;
      return {
        eye: add(move.target, scale(move.direction, d)),
        target: move.target,
        fov: move.fov,
      };
    }
  }
}

// Where the blocking puts people (see scene.ts): the singer at the front of the stage.
export const MARKS = {
  head: [0, 2.48, 1] as Vec3,
  chest: [0, 2.0, 1] as Vec3,
  stage: [0, 1.3, -0.8] as Vec3,
  floor: [0, 0.6, 0] as Vec3,
};

// The move for a shot-list camera; `side` (1 or -1) mirrors it so consecutive shots vary.
export function presetMove(camera: Camera, side: 1 | -1): CameraMove {
  switch (camera) {
    case "close-up":
      return cam.push(MARKS.head, [0.3 * side, 0.04, 1], 2.5, 1.85, 30);
    case "medium":
      return cam.dolly(
        [-1.7 * side, 1.95, 5.4],
        [1.7 * side, 1.95, 5.1],
        MARKS.chest,
        38,
      );
    case "wide":
      return cam.path(
        [
          [-6 * side, 2.6, 10.5],
          [0, 3.8, 12],
          [6 * side, 2.6, 10.5],
        ],
        MARKS.stage,
        48,
      );
    case "overhead":
      return cam.orbit(
        [0, 0, 0.6],
        3.4,
        10.5,
        -25 * side,
        25 * side,
        MARKS.floor,
        52,
      );
    case "orbit":
      return cam.orbit(
        [0, 0, 1],
        5.2,
        2.4,
        -60 * side,
        60 * side,
        MARKS.chest,
        42,
      );
    case "dolly":
      return cam.dolly(
        [0.8 * side, 1.7, 10],
        [0.3 * side, 1.85, 5.6],
        MARKS.chest,
        40,
      );
  }
}

export type CameraTrack = { cuts: { from: number; move: CameraMove }[] };

// One move for a single shot; for a burst, one cut per camera in `shot.burst`, equal lengths.
export function trackForShot(
  shot: Pick<Shot, "kind" | "camera" | "burst" | "index">,
): CameraTrack {
  const side: 1 | -1 = shot.index % 2 === 0 ? 1 : -1;
  if (shot.kind === "burst" && shot.burst.length > 0)
    return {
      cuts: shot.burst.map((camera, k) => ({
        from: k / shot.burst.length,
        move: presetMove(camera, (k % 2 === 0 ? side : -side) as 1 | -1),
      })),
    };
  return { cuts: [{ from: 0, move: presetMove(shot.camera, side) }] };
}

// The cut and the camera pose at a frame of a shot `frames` long.
export function poseAtFrame(
  track: CameraTrack,
  frame: number,
  frames: number,
): CameraPose & { cut: number } {
  const u = frames > 1 ? Math.min(1, Math.max(0, frame / (frames - 1))) : 0;
  let cut = 0;
  for (let k = 0; k < track.cuts.length; k++)
    if (u >= (track.cuts[k]?.from ?? 0)) cut = k;
  const from = track.cuts[cut]?.from ?? 0;
  const to = track.cuts[cut + 1]?.from ?? 1;
  const local = to > from ? (u - from) / (to - from) : 0;
  const move = track.cuts[cut]?.move ?? presetMove("wide", 1);
  return { ...poseOf(move, local), cut };
}
