import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CutPlanLine,
  type MvTake,
  planCuts,
  planFromShotList,
  planShots,
} from "@mellodifai/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  deliveredTake,
  LOCAL_VERSION,
  loadRung1Plan,
  MemoryMusicVideoStore,
  materializePlan,
  planOfStoryboard,
} from "../src/music-video-store.js";
import { testTempBase } from "./support/temp-base.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function scratch() {
  const root = await mkdtemp(join(await testTempBase(), "mv-store-tests-"));
  roots.push(root);
  return root;
}

function rung1() {
  const beats = Array.from({ length: 200 }, (_, i) => i * 0.5);
  const lines: CutPlanLine[] = [];
  for (let t = 20, n = 0; t < 88; t += 4, n += 4)
    lines.push({
      section: t < 52 ? "Verse 1" : "Chorus",
      text: `w${n} w${n + 1} w${n + 2} w${n + 3}`,
      words: [0, 1, 2, 3].map((k) => ({
        w: `w${n + k}`,
        start: t + k * 0.9 + 0.05,
        end: t + k * 0.9 + 0.8,
      })),
    });
  const cutPlan = planCuts({
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
  });
  return { cutPlan, shotList: planShots(cutPlan, { genre: "Italo-disco" }) };
}
const options = { title: "Va bene, passa", language: "Italian" };
const ids = { owner: "o", version: LOCAL_VERSION, now: "2026-11-14T10:00:00Z" };

describe("the storyboard store", () => {
  const { cutPlan, shotList } = rung1();
  const plan = planFromShotList(cutPlan, shotList, options);

  it("stores a plan as rows and gives the same plan back", () => {
    const board = materializePlan(plan, null, {
      ...ids,
      owner: "00000000-0000-4000-8000-000000000001",
    });
    expect(board.scenes.flatMap((s) => s.shots)).toHaveLength(
      plan.shots.length,
    );
    expect(planOfStoryboard(board, options)).toEqual(plan);
  });

  it("keeps edited elements on a new plan and refuses one once a take exists", async () => {
    const store = new MemoryMusicVideoStore();
    await store.savePlan(LOCAL_VERSION, plan);
    const first = await store.storyboard(LOCAL_VERSION);
    const element = first?.elements[0];
    if (!first || !element) throw new Error("no storyboard");
    element.name = "Lia";
    const again = materializePlan(plan, first, {
      ...ids,
      owner: first.project.owner_id,
    });
    expect(again.project.id).toBe(first.project.id);
    expect(again.elements.find((e) => e.id === element.id)?.name).toBe("Lia");

    const shot = first.scenes[0]?.shots[0];
    if (!shot) throw new Error("no shot");
    const take = await store.addTake({
      shot_id: shot.id,
      phase: "draft",
      model: "bytedance/seedance-2-5",
      prompt: "p",
      refs: [],
      params: {},
      cost_credits: 136,
      gates: null,
      status: "running",
    });
    await expect(store.savePlan(LOCAL_VERSION, plan)).rejects.toThrow(
      /already has takes/,
    );
    await expect(store.patchTake(take.id, { chosen: true })).rejects.toThrow(
      /done take/,
    );
    const done = await store.patchTake(take.id, {
      status: "done",
      chosen: true,
    });
    const other = await store.addTake({
      ...take,
      status: "done",
      chosen: true,
    });
    const takes = (await store.storyboard(LOCAL_VERSION))?.scenes[0]?.shots[0]
      ?.takes;
    expect(takes?.map((t) => [t.id, t.chosen])).toEqual([
      [done.id, false],
      [other.id, true],
    ]);
  });

  it("refuses a plan whose cast names a location", () => {
    const bad = structuredClone(plan);
    const shot = bad.shots[0];
    if (shot) shot.cast_keys = [shot.location_key ?? ""];
    expect(() => materializePlan(bad, null, ids)).toThrow();
  });

  it("keeps the storyboard in one file across restarts", async () => {
    const file = join(await scratch(), "storyboard.json");
    const store = new MemoryMusicVideoStore(file);
    await store.savePlan(LOCAL_VERSION, plan);
    const reopened = new MemoryMusicVideoStore(file);
    expect(await reopened.storyboard(LOCAL_VERSION)).toEqual(
      await store.storyboard(LOCAL_VERSION),
    );
    await expect(
      reopened.savePlan("00000000-0000-4000-8000-000000000009", plan),
    ).rejects.toThrow(/one song version/);
  });

  it("imports an old rung-1 folder and prefers its storyboard.json", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "cutplan.json"), JSON.stringify(cutPlan));
    await writeFile(join(dir, "shotlist.json"), JSON.stringify(shotList));
    expect(loadRung1Plan(dir, options)).toEqual({ plan, from: "files" });
    const store = new MemoryMusicVideoStore(join(dir, "storyboard.json"));
    const edited = structuredClone(plan);
    const first = edited.shots[0];
    if (first) first.size = "wide";
    await store.savePlan(LOCAL_VERSION, edited);
    expect(loadRung1Plan(dir, options)).toEqual({
      plan: edited,
      from: "storyboard",
    });
  });
});

describe("a re-run of the paid rung", () => {
  const take = (patch: Partial<MvTake>): MvTake => ({
    id: "00000000-0000-4000-8000-0000000000a1",
    shot_id: "00000000-0000-4000-8000-0000000000b1",
    phase: "draft",
    model: "m",
    prompt: null,
    refs: [],
    params: { taskId: "t1" },
    cost_credits: 408,
    gates: null,
    status: "done",
    chosen: false,
    created_at: "2026-11-14T00:00:00Z",
    ...patch,
  });

  it("reuses a take kie delivered when its file is still there, so nothing is paid twice", () => {
    const done = take({});
    const later = take({
      id: "00000000-0000-4000-8000-0000000000a2",
      params: { taskId: "t2" },
    });
    expect(deliveredTake([done, later], "draft", true)).toBe(later);
    expect(deliveredTake([done], "draft", false)).toBeNull();
    expect(deliveredTake([done], "final", true)).toBeNull();
    for (const other of [
      take({ status: "failed" }),
      take({ status: "running" }),
      take({ status: "quoted" }),
      take({ params: {} }),
    ])
      expect(deliveredTake([other], "draft", true)).toBeNull();
  });
});
