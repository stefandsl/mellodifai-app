// Where the music-video line keeps its storyboard (project, scenes, shots, elements, takes):
// the database for the worker's stages, one storyboard.json for lab scripts without a database
// login. Both follow public.mv_save_plan: a new plan keeps the elements already there (edits
// survive) and is refused once a take exists. Old rung-1 folders (cutplan.json, shotlist.json)
// import through `loadRung1Plan`.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type MvPlan,
  MvPlanSchema,
  type MvTake,
  MvTakeSchema,
  type PlanOptions,
  planFromFiles,
  type Storyboard,
  StoryboardSchema,
} from "@mellodifai/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export type NewTake = Omit<MvTake, "id" | "created_at" | "chosen"> & {
  chosen?: boolean;
};
export type TakePatch = Partial<
  Pick<
    MvTake,
    | "prompt"
    | "refs"
    | "params"
    | "cost_credits"
    | "gates"
    | "status"
    | "chosen"
  >
>;

export interface MusicVideoStore {
  savePlan(versionId: string, plan: MvPlan): Promise<string>;
  storyboard(versionId: string): Promise<Storyboard | null>;
  addTake(take: NewTake): Promise<MvTake>;
  patchTake(id: string, patch: TakePatch): Promise<MvTake>;
}

// Scripts outside the database name their one storyboard with these ids.
export const LOCAL_VERSION = "00000000-0000-4000-8000-000000000000";
export const LOCAL_OWNER = "00000000-0000-4000-8000-000000000001";

// The shot's latest take of a phase that kie already delivered (done, with its task id) while its
// file is still there: a re-run reuses it instead of paying for it again.
export function deliveredTake(
  takes: MvTake[],
  phase: MvTake["phase"],
  fileExists: boolean,
): MvTake | null {
  if (!fileExists) return null;
  const delivered = takes.filter(
    (t) =>
      t.phase === phase &&
      t.status === "done" &&
      typeof t.params.taskId === "string" &&
      t.params.taskId !== "",
  );
  return delivered.at(-1) ?? null;
}

// The plan as stored rows, after public.mv_save_plan.
export function materializePlan(
  input: MvPlan,
  previous: Storyboard | null,
  ids: { owner: string; version: string; now: string; id?: () => string },
): Storyboard {
  const plan = MvPlanSchema.parse(input);
  const id = ids.id ?? randomUUID;
  if (previous?.scenes.some((s) => s.shots.some((shot) => shot.takes.length)))
    throw new Error("the storyboard already has takes");
  const projectId = previous?.project.id ?? id();
  const elements = [...(previous?.elements ?? [])];
  for (const e of plan.elements)
    if (!elements.some((x) => x.key === e.key))
      elements.push({
        ...e,
        id: id(),
        project_id: projectId,
        updated_at: ids.now,
      });
  const byKey = new Map(elements.map((e) => [e.key, e]));
  const scenes = plan.scenes.map((s) => ({
    ...s,
    id: id(),
    project_id: projectId,
    shots: [] as Storyboard["scenes"][number]["shots"],
  }));
  for (const shot of plan.shots) {
    const scene = scenes.find((s) => s.position === shot.scene_position);
    if (!scene)
      throw new Error(`invalid plan: shot ${shot.position} has no scene`);
    const cast = shot.cast_keys.map((key) => byKey.get(key));
    if (cast.some((e) => !e || e.kind === "location"))
      throw new Error(`invalid plan: bad cast in shot ${shot.position}`);
    const location = shot.location_key ? byKey.get(shot.location_key) : null;
    if (shot.location_key && location?.kind !== "location")
      throw new Error(`invalid plan: bad location in shot ${shot.position}`);
    const {
      scene_position: _,
      cast_keys: __,
      location_key: ___,
      ...rest
    } = shot;
    scene.shots.push({
      ...rest,
      id: id(),
      project_id: projectId,
      scene_id: scene.id,
      cast_ids: cast.map((e) => e?.id as string),
      location_id: location?.id ?? null,
      updated_at: ids.now,
      takes: [],
    });
  }
  return StoryboardSchema.parse({
    project: {
      ...plan.project,
      id: projectId,
      owner_id: ids.owner,
      version_id: ids.version,
      created_at: previous?.project.created_at ?? ids.now,
      updated_at: ids.now,
    },
    elements: elements.sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    ),
    scenes,
  });
}

function allShots(board: Storyboard) {
  return board.scenes.flatMap((s) => s.shots);
}

// In memory, optionally kept in one JSON file (a Storyboard) after every change.
export class MemoryMusicVideoStore implements MusicVideoStore {
  private boards = new Map<string, Storyboard>();

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      const board = StoryboardSchema.parse(
        JSON.parse(readFileSync(file, "utf8")),
      );
      this.boards.set(board.project.version_id, board);
    }
  }

  private async persist(board: Storyboard) {
    this.boards.set(board.project.version_id, board);
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(board, null, 2)}\n`);
    await rename(tmp, this.file);
  }

  async savePlan(versionId: string, plan: MvPlan): Promise<string> {
    if (this.file && [...this.boards.keys()].some((v) => v !== versionId))
      throw new Error("a storyboard file holds one song version");
    const board = materializePlan(plan, this.boards.get(versionId) ?? null, {
      owner: this.boards.get(versionId)?.project.owner_id ?? LOCAL_OWNER,
      version: versionId,
      now: new Date().toISOString(),
    });
    await this.persist(board);
    return board.project.id;
  }

  async storyboard(versionId: string) {
    const board = this.boards.get(versionId);
    return board ? structuredClone(board) : null;
  }

  private find(shotId: string) {
    for (const board of this.boards.values()) {
      const shot = allShots(board).find((s) => s.id === shotId);
      if (shot) return { board, shot };
    }
    throw new Error("music video shot not found");
  }

  async addTake(input: NewTake): Promise<MvTake> {
    const { board, shot } = this.find(input.shot_id);
    const take = MvTakeSchema.parse({
      ...input,
      chosen: input.chosen ?? false,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    });
    if (take.chosen) for (const t of shot.takes) t.chosen = false;
    shot.takes.push(take);
    await this.persist(board);
    return structuredClone(take);
  }

  async patchTake(id: string, patch: TakePatch): Promise<MvTake> {
    for (const board of this.boards.values())
      for (const shot of allShots(board)) {
        const index = shot.takes.findIndex((t) => t.id === id);
        if (index < 0) continue;
        const take = MvTakeSchema.parse({ ...shot.takes[index], ...patch });
        if (take.chosen && take.status !== "done")
          throw new Error("only a done take can be chosen");
        if (take.chosen) for (const t of shot.takes) t.chosen = false;
        shot.takes[index] = take;
        await this.persist(board);
        return structuredClone(take);
      }
    throw new Error("music video take not found");
  }
}

// The worker's store: public.mv_save_plan and mv_storyboard_json, takes written directly with
// the service role.
export class SupabaseMusicVideoStore implements MusicVideoStore {
  constructor(private readonly client: SupabaseClient) {}

  async savePlan(versionId: string, plan: MvPlan): Promise<string> {
    const { data, error } = await this.client.rpc("mv_save_plan", {
      p_version: versionId,
      p_plan: MvPlanSchema.parse(plan),
    });
    if (error) throw error;
    return data as string;
  }

  async storyboard(versionId: string) {
    const { data, error } = await this.client.rpc("mv_storyboard_json", {
      p_version: versionId,
    });
    if (error) throw error;
    return data ? StoryboardSchema.parse(data) : null;
  }

  async addTake(take: NewTake): Promise<MvTake> {
    const shot = await this.client
      .from("mv_shots")
      .select("owner_id")
      .eq("id", take.shot_id)
      .single();
    if (shot.error) throw shot.error;
    if (take.chosen) await this.unchoose(take.shot_id);
    const { data, error } = await this.client
      .from("mv_takes")
      .insert({ ...take, owner_id: shot.data.owner_id })
      .select()
      .single();
    if (error) throw error;
    return MvTakeSchema.parse(data);
  }

  async patchTake(id: string, patch: TakePatch): Promise<MvTake> {
    if (patch.chosen) {
      const take = await this.client
        .from("mv_takes")
        .select("shot_id")
        .eq("id", id)
        .single();
      if (take.error) throw take.error;
      await this.unchoose(take.data.shot_id as string);
    }
    const { data, error } = await this.client
      .from("mv_takes")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return MvTakeSchema.parse(data);
  }

  private async unchoose(shotId: string) {
    const { error } = await this.client
      .from("mv_takes")
      .update({ chosen: false })
      .eq("shot_id", shotId)
      .eq("chosen", true);
    if (error) throw error;
  }
}

// A rung-1 folder as a plan: storyboard.json when the folder has one, else its old
// cutplan.json and shotlist.json.
export function loadRung1Plan(
  dir: string,
  options: PlanOptions,
): { plan: MvPlan; from: "storyboard" | "files" } {
  const board = join(dir, "storyboard.json");
  if (existsSync(board)) {
    const sb = StoryboardSchema.parse(JSON.parse(readFileSync(board, "utf8")));
    return { plan: planOfStoryboard(sb, options), from: "storyboard" };
  }
  const read = (name: string) =>
    JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
  return {
    plan: planFromFiles(
      { cutplan: read("cutplan.json"), shotlist: read("shotlist.json") },
      options,
    ),
    from: "files",
  };
}

// A stored storyboard back as a plan (ids become keys); `options.elements` replace stored
// elements of the same key.
export function planOfStoryboard(sb: Storyboard, options: PlanOptions): MvPlan {
  const given = new Map((options.elements ?? []).map((e) => [e.key, e]));
  const keyOf = new Map(sb.elements.map((e) => [e.id, e.key]));
  return MvPlanSchema.parse({
    project: {
      title: options.title,
      language: options.language,
      genre: sb.project.genre,
      aspect: options.aspect ?? sb.project.aspect,
      fps: sb.project.fps,
      frames: sb.project.frames,
      look: { ...sb.project.look, ...options.look },
      cut_plan: sb.project.cut_plan,
    },
    elements: [
      ...sb.elements.map(
        ({ key, kind, name, description, ref_asset_ids }) =>
          given.get(key) ?? { key, kind, name, description, ref_asset_ids },
      ),
      ...[...given.values()].filter(
        (e) => !keyOf.has(e.key) && !sb.elements.some((x) => x.key === e.key),
      ),
    ],
    scenes: sb.scenes.map(
      ({ position, section, section_kind, start_frame, end_frame }) => ({
        position,
        section,
        section_kind,
        start_frame,
        end_frame,
      }),
    ),
    shots: sb.scenes.flatMap((scene) =>
      scene.shots.map((s) => ({
        position: s.position,
        scene_position: scene.position,
        segment: s.segment,
        start_frame: s.start_frame,
        end_frame: s.end_frame,
        kind: s.kind,
        size: s.size,
        angle: s.angle,
        movement: s.movement,
        lens: s.lens,
        burst: s.burst,
        mood: s.mood,
        lyrics: s.lyrics,
        energy: s.energy,
        cast_keys: s.cast_ids.map((id) => keyOf.get(id) as string),
        location_key: s.location_id ? (keyOf.get(s.location_id) ?? null) : null,
      })),
    ),
  });
}
