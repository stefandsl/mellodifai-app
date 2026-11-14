import { describe, expect, it } from "vitest";
import { type CutPlanInput, type CutPlanLine, planCuts } from "./cut-plan.js";
import { takeQuote } from "./prices.js";
import { planShots } from "./shot-list.js";
import {
  MvPlanSchema,
  type MvTake,
  planFromFiles,
  planFromShotList,
  selectedTake,
} from "./storyboard.js";

// 120 BPM, a bar every 2 s; four-word lines over two bars from 20 s to 88 s.
function song(): CutPlanInput {
  const beats = Array.from({ length: 200 }, (_, i) => i * 0.5);
  const lines: CutPlanLine[] = [];
  let n = 0;
  for (let t = 20; t < 88; t += 4) {
    lines.push({
      section: t < 52 ? "Verse 1" : "Chorus",
      text: `w${n} w${n + 1} w${n + 2} w${n + 3}`,
      words: [0, 1, 2, 3].map((k) => ({
        w: `w${n + k}`,
        start: t + k * 0.9 + 0.05,
        end: t + k * 0.9 + 0.8,
      })),
    });
    n += 4;
  }
  return {
    duration: 100,
    lines,
    sections: [
      { name: "Intro", start: 0, end: 20 },
      { name: "Verse 1", start: 20, end: 52 },
      { name: "Chorus", start: 52, end: 84 },
      { name: "Outro", start: 84, end: 100 },
    ],
    downbeats: beats.filter((_, i) => i % 4 === 0),
    beats,
  };
}

const cutPlan = planCuts(song());
const shotList = planShots(cutPlan, { genre: "Italo-disco" });

describe("planFromShotList", () => {
  const plan = planFromShotList(cutPlan, shotList, {
    title: "Va bene, passa",
    language: "Italian",
    elements: [
      {
        key: "set-chorus",
        kind: "location",
        name: "the disco stage",
        description: "mirrored floor",
        ref_asset_ids: ["images/set-chorus.png"],
      },
    ],
  });

  it("keeps one shot per segment on the cut plan's frames", () => {
    expect(plan.shots).toHaveLength(cutPlan.segments.length);
    plan.shots.forEach((shot, i) => {
      const seg = cutPlan.segments[i];
      expect(shot.start_frame).toBe(seg?.startFrame);
      expect(shot.end_frame).toBe(seg?.endFrame);
      expect(shot.lyrics).toBe(seg?.text);
    });
    expect(plan.project.frames).toBe(cutPlan.frames);
    expect(plan.project.cut_plan).toEqual(cutPlan);
  });

  it("makes one scene per section run covering its shots", () => {
    plan.scenes.slice(1).forEach((scene, i) => {
      expect(scene.section).not.toBe(plan.scenes[i]?.section);
    });
    for (const scene of plan.scenes) {
      const shots = plan.shots.filter(
        (s) => s.scene_position === scene.position,
      );
      expect(shots[0]?.start_frame).toBe(scene.start_frame);
      expect(shots.at(-1)?.end_frame).toBe(scene.end_frame);
    }
    expect(plan.scenes.at(-1)?.end_frame).toBe(cutPlan.frames);
    expect(new Set(plan.scenes.map((s) => s.section))).toEqual(
      new Set(shotList.shots.map((s) => s.section)),
    );
  });

  it("maps costumes to cast and sets to locations, keeping given elements", () => {
    const keys = plan.elements.map((e) => e.key).sort();
    expect(keys).toEqual(
      [...new Set(shotList.shots.flatMap((s) => [s.costume, s.set]))].sort(),
    );
    expect(plan.elements.find((e) => e.key === "set-chorus")).toMatchObject({
      name: "the disco stage",
      ref_asset_ids: ["images/set-chorus.png"],
    });
    plan.shots.forEach((shot, i) => {
      expect(shot.cast_keys).toEqual([shotList.shots[i]?.costume]);
      expect(shot.location_key).toBe(shotList.shots[i]?.set);
    });
  });

  it("turns camera presets into size, angle, movement and lens", () => {
    shotList.shots.forEach((s, i) => {
      const shot = plan.shots[i];
      if (s.camera === "close-up") expect(shot?.size).toBe("close-up");
      if (s.camera === "overhead") expect(shot?.angle).toBe("overhead");
      if (s.camera === "orbit") expect(shot?.movement).toBe("orbit");
    });
  });

  it("reads old rung-1 files the same way", () => {
    expect(
      planFromFiles(
        {
          cutplan: JSON.parse(JSON.stringify(cutPlan)),
          shotlist: JSON.parse(JSON.stringify(shotList)),
        },
        { title: "Va bene, passa", language: "Italian" },
      ),
    ).toEqual(
      planFromShotList(cutPlan, shotList, {
        title: "Va bene, passa",
        language: "Italian",
      }),
    );
    expect(() =>
      planFromFiles(
        { cutplan: { version: 2 }, shotlist: shotList },
        { title: "x", language: "Italian" },
      ),
    ).toThrow();
  });

  it("refuses a location in the cast", () => {
    const bad = structuredClone(plan);
    const shot = bad.shots[0];
    if (shot) shot.cast_keys = [shot.location_key ?? ""];
    expect(MvPlanSchema.safeParse(bad).success).toBe(false);
  });
});

describe("takeQuote", () => {
  it("prices the reference video and the output at the phase's rate", () => {
    expect(takeQuote({ start_frame: 0, end_frame: 300 }, 30, "draft")).toEqual({
      model: "bytedance/seedance-2-5",
      seconds: 10,
      credits: 17 * 20,
    });
    expect(takeQuote({ start_frame: 0, end_frame: 300 }, 30, "final")).toEqual({
      model: "bytedance/seedance-2-5-draft",
      seconds: 10,
      credits: 95 * 20,
    });
    // 3.5 s: generated at the 4 s minimum, reference billed at 4 s.
    expect(takeQuote({ start_frame: 30, end_frame: 135 }, 30, "draft")).toEqual(
      {
        model: "bytedance/seedance-2-5",
        seconds: 4,
        credits: 17 * 8,
      },
    );
  });
});

describe("selectedTake", () => {
  const take = (over: Partial<MvTake>): MvTake => ({
    id: "00000000-0000-4000-8000-000000000001",
    shot_id: "00000000-0000-4000-8000-000000000002",
    phase: "draft",
    model: "m",
    prompt: null,
    refs: [],
    params: {},
    cost_credits: 0,
    gates: null,
    status: "done",
    chosen: false,
    created_at: "2026-11-14T10:00:00Z",
    ...over,
  });
  it("prefers the chosen take, then the newest done final, then the newest done draft", () => {
    const a = take({ id: "a", created_at: "2026-11-14T10:00:00Z" });
    const b = take({ id: "b", created_at: "2026-11-14T11:00:00Z" });
    const f = take({
      id: "f",
      phase: "final",
      created_at: "2026-11-14T09:00:00Z",
    });
    const q = take({
      id: "q",
      status: "quoted",
      created_at: "2026-11-14T12:00:00Z",
    });
    expect(selectedTake([a, b, q])?.id).toBe("b");
    expect(selectedTake([a, b, f])?.id).toBe("f");
    expect(selectedTake([a, { ...b, chosen: true }, f])?.id).toBe("b");
    expect(selectedTake([q])).toBeNull();
  });
});
