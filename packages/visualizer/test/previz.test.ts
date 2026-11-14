import { CAMERAS, type Shot } from "@mellodifai/shared";
import { describe, expect, it } from "vitest";
import {
  cam,
  MARKS,
  poseAtFrame,
  poseOf,
  presetMove,
  trackForShot,
} from "../src/previz/camera";
import { currentLine } from "../src/previz/Previz";
import { eyeInside, polygons, project, viewOf } from "../src/previz/raster";
import { sceneAt } from "../src/previz/scene";

const W = 1280;
const H = 720;
const FRAMES = 360;
const SETS = ["set-establishing", "set-verse", "set-chorus", "set-bridge"];

function shot(over: Partial<Shot>): Shot {
  return {
    index: 0,
    segment: 0,
    start: 0,
    end: 12,
    startFrame: 0,
    endFrame: FRAMES,
    section: "Verse 1",
    sectionKind: "verse",
    kind: "lipsync-single",
    camera: "close-up",
    burst: [],
    set: "set-verse",
    costume: "costume-a",
    energy: 0.5,
    lyrics: "la la",
    prompt: "p",
    ...over,
  };
}

const samples = Array.from({ length: 13 }, (_, i) =>
  Math.round((i / 12) * (FRAMES - 1)),
);

describe("previz camera", () => {
  it("never puts the camera inside the set, stage or people", () => {
    for (const set of SETS)
      for (const camera of CAMERAS)
        for (const index of [0, 1]) {
          const track = trackForShot(shot({ camera, index, set }));
          for (const f of samples) {
            const pose = poseAtFrame(track, f, FRAMES);
            const boxes = sceneAt({
              set,
              time: f / 30,
              beats: [],
              singing: true,
            });
            expect(eyeInside(boxes, pose.eye), `${set} ${camera} ${f}`).toBe(
              false,
            );
          }
        }
  });

  it("keeps the singer's head in frame on every performance camera", () => {
    for (const camera of CAMERAS)
      for (const index of [0, 1]) {
        const track = trackForShot(shot({ camera, index }));
        for (const f of samples) {
          const view = viewOf(poseAtFrame(track, f, FRAMES), W, H);
          const head = project(view, MARKS.head);
          expect(head, `${camera} ${f}`).not.toBeNull();
          expect(head?.x).toBeGreaterThan(W * 0.08);
          expect(head?.x).toBeLessThan(W * 0.92);
          expect(head?.y).toBeGreaterThan(H * 0.05);
          expect(head?.y).toBeLessThan(H * 0.9);
        }
      }
  });

  it("draws a full frame with the singer visible, never an empty one", () => {
    for (const set of SETS)
      for (const camera of CAMERAS) {
        const track = trackForShot(shot({ camera, set }));
        for (const f of [0, 179, 359]) {
          const polys = polygons(
            sceneAt({ set, time: f / 30, beats: [], singing: false }),
            poseAtFrame(track, f, FRAMES),
            W,
            H,
          );
          const onScreen = (tag: string) =>
            polys.some(
              (p) =>
                p.tag === tag &&
                p.points.some(
                  (pt) => pt.x >= 0 && pt.x <= W && pt.y >= 0 && pt.y <= H,
                ),
            );
          expect(polys.length, `${set} ${camera}`).toBeGreaterThan(20);
          expect(onScreen("performer"), `${set} ${camera} ${f}`).toBe(true);
          expect(onScreen("stage") || onScreen("set")).toBe(true);
        }
      }
  });

  it("is deterministic by frame and moves through the shot", () => {
    const track = trackForShot(shot({ camera: "orbit" }));
    expect(poseAtFrame(track, 100, FRAMES)).toEqual(
      poseAtFrame(track, 100, FRAMES),
    );
    expect(poseAtFrame(track, 0, FRAMES).eye).not.toEqual(
      poseAtFrame(track, FRAMES - 1, FRAMES).eye,
    );
    // Mirrored on odd shots so consecutive shots differ.
    expect(trackForShot(shot({ camera: "orbit", index: 1 }))).not.toEqual(
      track,
    );
  });

  it("cuts a burst into its cameras in order, at equal lengths", () => {
    const burst = ["wide", "close-up", "orbit", "medium", "overhead"] as const;
    const track = trackForShot(
      shot({ kind: "burst", camera: "wide", burst: [...burst] }),
    );
    expect(track.cuts.map((c) => c.from)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    for (let k = 0; k < burst.length; k++) {
      const frame = Math.round((k / 5 + 0.1) * (FRAMES - 1));
      const pose = poseAtFrame(track, frame, FRAMES);
      expect(pose.cut).toBe(k);
      expect(pose.fov).toBe(
        presetMove(burst[k] as (typeof burst)[number], 1).fov,
      );
    }
  });

  it("the DSL moves: path through points, orbit around, push in, dolly between", () => {
    const path = cam.path(
      [
        [0, 0, 0],
        [10, 0, 0],
        [10, 0, 10],
      ],
      [0, 0, 0],
    );
    expect(poseOf(path, 0).eye).toEqual([0, 0, 0]);
    expect(poseOf(path, 0.5).eye).toEqual([10, 0, 0]);
    expect(poseOf(path, 1).eye).toEqual([10, 0, 10]);
    const orbit = cam.orbit([0, 0, 0], 5, 2, 0, 90, [0, 0, 0]);
    expect(poseOf(orbit, 0).eye[2]).toBeCloseTo(5);
    expect(poseOf(orbit, 1).eye[0]).toBeCloseTo(5);
    const push = cam.push([0, 0, 0], [0, 0, 1], 4, 2);
    expect(poseOf(push, 0).eye[2]).toBeCloseTo(4);
    expect(poseOf(push, 1).eye[2]).toBeCloseTo(2);
    const dolly = cam.dolly([0, 1, 5], [4, 1, 5], [0, 1, 0]);
    expect(poseOf(dolly, 1).eye).toEqual([4, 1, 5]);
    expect(poseOf(cam.lookAt([1, 2, 3], [0, 0, 0]), 0.7).eye).toEqual([
      1, 2, 3,
    ]);
  });

  it("projects the look-at point to the centre of the frame", () => {
    const view = viewOf({ eye: [3, 4, 9], target: [0, 1, 0], fov: 40 }, W, H);
    const p = project(view, [0, 1, 0]);
    expect(p?.x).toBeCloseTo(W / 2);
    expect(p?.y).toBeCloseTo(H / 2);
    expect(project(view, [6, 7, 18])).toBeNull();
  });
});

describe("previz scene", () => {
  it("has a stage, a band, the singer and a different placeholder per set", () => {
    const tags = (set: string) =>
      new Set(
        sceneAt({ set, time: 0, beats: [], singing: false }).map((b) => b.tag),
      );
    for (const set of SETS)
      expect([...tags(set)].sort()).toEqual([
        "band",
        "floor",
        "performer",
        "set",
        "stage",
      ]);
    const setBoxes = (set: string) =>
      JSON.stringify(
        sceneAt({ set, time: 0, beats: [], singing: false }).filter(
          (b) => b.tag === "set",
        ),
      );
    expect(new Set(SETS.map(setBoxes)).size).toBe(SETS.length);
  });

  it("opens the mouth only while singing and moves on the beat", () => {
    const at = (time: number, singing: boolean) =>
      sceneAt({ set: "set-verse", time, beats: [0, 0.5, 1, 1.5], singing });
    expect(at(0.2, true).length).toBe(at(0.2, false).length + 1);
    expect(at(0, false)).not.toEqual(at(0.4, false));
    expect(at(0.3, false)).toEqual(at(0.3, false));
  });

  it("shows the lyric line being sung", () => {
    const words = [
      { text: "uno", start: 0, end: 0.4, line: 0 },
      { text: "due", start: 0.5, end: 0.9, line: 0 },
      { text: "tre", start: 3, end: 3.5, line: 1 },
    ];
    expect(currentLine(words, 0.6)).toBe("uno due");
    expect(currentLine(words, 3.2)).toBe("tre");
    expect(currentLine(words, 2.8)).toBe("");
  });
});
