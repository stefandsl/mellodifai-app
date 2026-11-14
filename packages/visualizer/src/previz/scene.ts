// The grey-box set of the previz: a stage, a band (guitar, bass, drums on a riser), the singer
// at a mic stand, and a placeholder for the shot's set. Figures move on the beat and the
// singer's mouth opens on sung words, all as a pure function of the time.
import type { Vec3 } from "./camera";

export type Tag = "floor" | "stage" | "set" | "band" | "performer";

export type Box = {
  center: Vec3;
  size: Vec3;
  color: string;
  // Rotation around the vertical axis, radians.
  rotY?: number;
  tag: Tag;
  // Drawn in this order before depth: the floor, then the stage, then the riser, then the rest.
  layer: 0 | 1 | 2 | 3;
};

export type SceneInput = {
  set: string;
  // Seconds from the start of the shot.
  time: number;
  // Beat times in seconds from the start of the shot.
  beats: number[];
  // True while a word is sounding.
  singing: boolean;
};

const STAGE_TOP = 0.6;
const RISER_TOP = STAGE_TOP + 0.5;

const COLORS = {
  performer: "#e4ddd2",
  skin: "#efe7dc",
  band: "#a3a3a8",
  gear: "#6d6d73",
  stage: "#55565c",
  riser: "#626369",
  mouth: "#2a2224",
};

const SET_COLORS: Record<string, string> = {
  "set-establishing": "#7a7c85",
  "set-verse": "#6d7a8c",
  "set-chorus": "#8a7398",
  "set-bridge": "#6c8a82",
};

// 0 on the beat, rising to 1 just before the next one.
export function beatPhase(time: number, beats: number[]) {
  let prev = Number.NEGATIVE_INFINITY;
  let next = Number.POSITIVE_INFINITY;
  for (const b of beats) {
    if (b <= time) prev = b;
    else {
      next = b;
      break;
    }
  }
  if (!Number.isFinite(prev) || !Number.isFinite(next)) {
    const period = 0.5;
    return (((time % period) + period) % period) / period;
  }
  return (time - prev) / (next - prev);
}

function box(
  center: Vec3,
  size: Vec3,
  color: string,
  tag: Tag,
  layer: Box["layer"] = 3,
  rotY = 0,
): Box {
  return { center, size, color, tag, layer, rotY };
}

// A standing grey-box person with feet at (x, base, z), facing +z.
function person(
  x: number,
  base: number,
  z: number,
  tag: Tag,
  color: string,
  pose: { bob: number; sway: number; armUp: number; mouth: number },
): Box[] {
  const y = base + pose.bob;
  const sx = x + pose.sway;
  const out: Box[] = [
    box([x - 0.13, base + 0.45, z], [0.17, 0.9, 0.2], color, tag),
    box([x + 0.13, base + 0.45, z], [0.17, 0.9, 0.2], color, tag),
    box([sx, y + 1.25, z], [0.5, 0.7, 0.28], color, tag),
    box([sx, y + 1.68, z], [0.12, 0.12, 0.12], color, tag),
    box(
      [sx, y + 1.9, z],
      [0.3, 0.34, 0.3],
      tag === "performer" ? COLORS.skin : color,
      tag,
    ),
    box(
      [sx - 0.33, y + 1.2 + pose.armUp * 0.25, z + pose.armUp * 0.12],
      [0.13, 0.62, 0.15],
      color,
      tag,
    ),
    box([sx + 0.33, y + 1.2, z], [0.13, 0.62, 0.15], color, tag),
  ];
  if (pose.mouth > 0)
    out.push(
      box(
        [sx, y + 1.83, z + 0.16],
        [0.12, 0.025 + pose.mouth * 0.06, 0.01],
        COLORS.mouth,
        tag,
      ),
    );
  return out;
}

// `a` moved `k` of the way toward `b` (hex colours).
export function mix(a: string, b: string, k: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - k) + ((pb >> shift) & 255) * k);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

function setPieces(set: string): Box[] {
  const color = SET_COLORS[set] ?? (SET_COLORS["set-establishing"] as string);
  // A dark back wall so the set pieces and the people read in front of it.
  const wall = box([0, 4, -6], [22, 8, 0.4], mix(color, "#14151b", 0.6), "set");
  switch (set) {
    case "set-verse":
      // A row of buildings: the street of the verses.
      return [
        wall,
        ...[-5.8, -3.5, -1.2, 1.2, 3.5, 5.8].map((x, i) =>
          box([x, 1.5 + (i % 3), -5], [2.2, 3 + (i % 3) * 2, 1], color, "set"),
        ),
      ];
    case "set-chorus":
      // A big screen in a frame and a lighting truss over the stage.
      return [
        wall,
        box([0, 4.6, -5.7], [9, 0.3, 0.3], "#b9a6c6", "set"),
        box([0, 1.4, -5.7], [9, 0.3, 0.3], "#b9a6c6", "set"),
        box([-4.5, 3, -5.7], [0.3, 3.5, 0.3], "#b9a6c6", "set"),
        box([4.5, 3, -5.7], [0.3, 3.5, 0.3], "#b9a6c6", "set"),
        box([0, 3, -5.78], [8.7, 2.9, 0.06], "#3c3346", "set"),
        box([0, 6.2, -1], [12, 0.35, 0.35], "#8d8d94", "set"),
        box([-6, 3.1, -1], [0.3, 6.2, 0.3], "#8d8d94", "set"),
        box([6, 3.1, -1], [0.3, 6.2, 0.3], "#8d8d94", "set"),
      ];
    case "set-bridge":
      // Three arches: the quieter, stranger place of the bridge.
      return [
        wall,
        ...[-5, 0, 5].flatMap((x) => [
          box([x - 1.3, 2.2, -5], [0.6, 4.4, 0.6], color, "set"),
          box([x + 1.3, 2.2, -5], [0.6, 4.4, 0.6], color, "set"),
          box([x, 4.7, -5], [3.2, 0.6, 0.6], color, "set"),
        ]),
      ];
    default:
      // Two light towers either side of a plain back wall.
      return [
        wall,
        box([-6.2, 3.6, -4], [0.7, 6, 0.7], "#8d8d94", "set"),
        box([6.2, 3.6, -4], [0.7, 6, 0.7], "#8d8d94", "set"),
        box([-6.2, 6.8, -4], [1.6, 0.5, 0.6], "#c9c9cf", "set"),
        box([6.2, 6.8, -4], [1.6, 0.5, 0.6], "#c9c9cf", "set"),
      ];
  }
}

export function sceneAt(input: SceneInput): Box[] {
  const phase = beatPhase(input.time, input.beats);
  const hit = (1 - phase) ** 2;
  const swing = Math.sin(input.time * Math.PI);
  const boxes: Box[] = [
    box([0, -0.05, 0], [60, 0.1, 60], "#26272c", "floor", 0),
    box([0, STAGE_TOP / 2, -1.5], [14, STAGE_TOP, 8], COLORS.stage, "stage", 1),
    box([0, STAGE_TOP + 0.25, -3.3], [3.6, 0.5, 2.6], COLORS.riser, "stage", 2),
    ...setPieces(input.set),
  ];
  // The band: guitar left, bass right, drums on the riser.
  boxes.push(
    ...person(-3.2, STAGE_TOP, -1.3, "band", COLORS.band, {
      bob: hit * 0.04,
      sway: swing * 0.06,
      armUp: 0,
      mouth: 0,
    }),
    box(
      [-3.2 + swing * 0.06, STAGE_TOP + 1.1, -1.05],
      [0.9, 0.28, 0.08],
      COLORS.gear,
      "band",
      3,
      -0.4,
    ),
    ...person(3.2, STAGE_TOP, -1.3, "band", COLORS.band, {
      bob: hit * 0.04,
      sway: -swing * 0.06,
      armUp: 0,
      mouth: 0,
    }),
    box(
      [3.2 - swing * 0.06, STAGE_TOP + 1.1, -1.05],
      [1.1, 0.24, 0.08],
      COLORS.gear,
      "band",
      3,
      0.4,
    ),
    box([0, RISER_TOP + 0.3, -3.4], [0.5, 0.6, 0.5], COLORS.band, "band"),
    box([0, RISER_TOP + 0.9, -3.4], [0.5, 0.65, 0.3], COLORS.band, "band"),
    box([0, RISER_TOP + 1.38, -3.4], [0.28, 0.3, 0.28], COLORS.band, "band"),
    box([0, RISER_TOP + 0.35, -2.6], [0.7, 0.7, 0.45], COLORS.gear, "band"),
    box(
      [-0.7, RISER_TOP + 0.75 + hit * 0.08, -2.75],
      [0.45, 0.2, 0.45],
      COLORS.gear,
      "band",
    ),
    box([0.7, RISER_TOP + 0.75, -2.75], [0.45, 0.2, 0.45], COLORS.gear, "band"),
    box([-1.1, RISER_TOP + 1.3, -3], [0.6, 0.03, 0.6], "#b7a46a", "band"),
    box(
      [1.1, RISER_TOP + 1.4 + hit * 0.05, -3],
      [0.6, 0.03, 0.6],
      "#b7a46a",
      "band",
    ),
  );
  // The singer at the front, a mic stand in front of her.
  boxes.push(
    ...person(0, STAGE_TOP, 1, "performer", COLORS.performer, {
      bob: hit * 0.05,
      sway: Math.sin(input.time * Math.PI * 0.5) * 0.05,
      armUp: input.singing ? 0.4 + hit * 0.3 : 0,
      mouth: input.singing
        ? 0.5 + 0.5 * Math.abs(Math.sin(input.time * 14))
        : 0,
    }),
    box(
      [0, STAGE_TOP + 0.83, 1.5],
      [0.04, 1.56, 0.04],
      COLORS.gear,
      "performer",
    ),
    box([0, STAGE_TOP + 0.02, 1.5], [0.4, 0.04, 0.4], COLORS.gear, "performer"),
    box(
      [0, STAGE_TOP + 1.7, 1.36],
      [0.07, 0.07, 0.22],
      COLORS.gear,
      "performer",
    ),
  );
  return boxes;
}
