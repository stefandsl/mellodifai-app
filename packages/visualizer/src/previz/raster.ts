// A small flat-shaded box renderer on a 2D canvas: perspective projection, near-plane clipping,
// back-face culling and painter's order by layer then depth. Enough for grey-box blocking, with
// no WebGL and no new dependency.
import {
  type CameraPose,
  cross,
  dot,
  normalize,
  sub,
  type Vec3,
} from "./camera";
import type { Box } from "./scene";

const NEAR = 0.05;
const LIGHT = normalize([0.45, 1, 0.65]);
export const BACKGROUND = "#101116";

export type View = {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  focal: number;
  width: number;
  height: number;
};

export function viewOf(pose: CameraPose, width: number, height: number): View {
  const forward = normalize(sub(pose.target, pose.eye));
  let right = cross(forward, [0, 1, 0]);
  if (Math.hypot(...right) < 1e-6) right = cross(forward, [0, 0, -1]);
  right = normalize(right);
  const up = cross(right, forward);
  const focal = height / 2 / Math.tan(((pose.fov / 2) * Math.PI) / 180);
  return { eye: pose.eye, right, up, forward, focal, width, height };
}

// Camera space: x right, y up, z = depth along the view.
export function toCamera(view: View, p: Vec3): Vec3 {
  const d = sub(p, view.eye);
  return [dot(d, view.right), dot(d, view.up), dot(d, view.forward)];
}

// The pixel of a world point, or null behind the camera.
export function project(
  view: View,
  p: Vec3,
): { x: number; y: number; z: number } | null {
  const c = toCamera(view, p);
  if (c[2] <= NEAR) return null;
  return {
    x: view.width / 2 + (c[0] / c[2]) * view.focal,
    y: view.height / 2 - (c[1] / c[2]) * view.focal,
    z: c[2],
  };
}

function corners(b: Box): Vec3[] {
  const [hx, hy, hz] = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];
  const c = Math.cos(b.rotY ?? 0);
  const s = Math.sin(b.rotY ?? 0);
  const out: Vec3[] = [];
  for (const dy of [-hy, hy])
    for (const [dx, dz] of [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ] as const)
      out.push([
        b.center[0] + dx * c + dz * s,
        b.center[1] + dy,
        b.center[2] - dx * s + dz * c,
      ]);
  return out;
}

// Corner indices of each face (outer normals are fixed up when drawing).
const FACES = [
  [4, 5, 6, 7], // top
  [3, 2, 1, 0], // bottom
  [3, 7, 6, 2], // +z
  [1, 5, 4, 0], // -z
  [2, 6, 5, 1], // +x
  [0, 4, 7, 3], // -x
] as const;

function shade(hex: string, k: number, fog: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const bg = Number.parseInt(BACKGROUND.slice(1), 16);
  const ch = (v: number, b: number) =>
    Math.round(Math.min(255, v * k) * (1 - fog) + b * fog);
  return `rgb(${ch((n >> 16) & 255, (bg >> 16) & 255)},${ch((n >> 8) & 255, (bg >> 8) & 255)},${ch(n & 255, bg & 255)})`;
}

export type Polygon = {
  points: { x: number; y: number }[];
  fill: string;
  tag: Box["tag"];
  layer: number;
  depth: number;
};

// The visible faces of the boxes, clipped and projected, in drawing order.
export function polygons(
  boxes: Box[],
  pose: CameraPose,
  width: number,
  height: number,
): Polygon[] {
  const view = viewOf(pose, width, height);
  const out: Polygon[] = [];
  for (const b of boxes) {
    const world = corners(b);
    for (const face of FACES) {
      const p = face.map((i) => world[i] as Vec3);
      const [p0, p1, p2] = p as [Vec3, Vec3, Vec3];
      const centre: Vec3 = [
        (p0[0] + p2[0]) / 2,
        (p0[1] + p2[1]) / 2,
        (p0[2] + p2[2]) / 2,
      ];
      let normal = normalize(cross(sub(p1, p0), sub(p2, p1)));
      // Point the normal out of the box whatever the corner order.
      if (dot(normal, sub(centre, b.center)) < 0)
        normal = [-normal[0], -normal[1], -normal[2]];
      if (dot(normal, sub(view.eye, centre)) <= 0) continue;
      // Clip against the near plane (Sutherland-Hodgman on depth).
      const cam = p.map((v) => toCamera(view, v));
      const clipped: Vec3[] = [];
      for (let i = 0; i < cam.length; i++) {
        const a = cam[i] as Vec3;
        const b2 = cam[(i + 1) % cam.length] as Vec3;
        const ina = a[2] > NEAR;
        const inb = b2[2] > NEAR;
        if (ina) clipped.push(a);
        if (ina !== inb) {
          const t = (NEAR - a[2]) / (b2[2] - a[2]);
          clipped.push([
            a[0] + (b2[0] - a[0]) * t,
            a[1] + (b2[1] - a[1]) * t,
            NEAR,
          ]);
        }
      }
      if (clipped.length < 3) continue;
      const depth = clipped.reduce((s, v) => s + v[2], 0) / clipped.length;
      const light = 0.42 + 0.58 * Math.max(0, dot(normal, LIGHT));
      out.push({
        points: clipped.map((v) => ({
          x: width / 2 + (v[0] / v[2]) * view.focal,
          y: height / 2 - (v[1] / v[2]) * view.focal,
        })),
        fill: shade(
          b.color,
          light,
          Math.min(0.6, Math.max(0, (depth - 8) / 40)),
        ),
        tag: b.tag,
        layer: b.layer,
        depth,
      });
    }
  }
  return out.sort((a, b) => a.layer - b.layer || b.depth - a.depth);
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  boxes: Box[],
  pose: CameraPose,
  width: number,
  height: number,
) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#1b1d26");
  sky.addColorStop(1, BACKGROUND);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  for (const poly of polygons(boxes, pose, width, height)) {
    ctx.beginPath();
    poly.points.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.fillStyle = poly.fill;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// True when the eye is inside a box (grown by `margin`): the camera would sit in geometry.
export function eyeInside(boxes: Box[], eye: Vec3, margin = 0.1): boolean {
  return boxes.some((b) => {
    if (b.tag === "floor") return eye[1] < b.center[1] + b.size[1] / 2 + margin;
    const c = Math.cos(-(b.rotY ?? 0));
    const s = Math.sin(-(b.rotY ?? 0));
    const dx = eye[0] - b.center[0];
    const dz = eye[2] - b.center[2];
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    return (
      Math.abs(lx) <= b.size[0] / 2 + margin &&
      Math.abs(eye[1] - b.center[1]) <= b.size[1] / 2 + margin &&
      Math.abs(lz) <= b.size[2] / 2 + margin
    );
  });
}
