import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ACE_REWRITE_DENOISE,
  KIE_CREDITS,
  LyricPackSchema,
  parseLyricTiming,
  REWRITE_CROSSFADE,
  readControls,
  rewriteWindow,
  rewrittenTiming,
  sectionProblem,
  styleWithout,
  windowLyrics,
} from "@mellodifai/shared";
import {
  AUDIO_INPUT_NODES,
  aceGraph,
  bpmAndKey,
  loadGraph,
  withSourceAudio,
} from "../comfy/graphs.js";
import { LOCAL_LIMITS } from "../comfy/runtime.js";
import type { SectionAlternative, SectionEdit, Take } from "../db.js";
import {
  KieClient,
  KieFailed,
  KieRefused,
  type KieTrack,
} from "../kie/client.js";
import type { StageContext, StageHandler, StageResult } from "../loop.js";
import { encode, matchGain, probeSeconds, splice } from "./audio-util.js";
import { LOCAL_TEXT, LocalGeneration, takeSeeds } from "./local-engine.js";
import { takeAudio } from "./take-audio.js";
import { language, upload } from "./utils.js";

// Fixed Italian sentences for the studio; the job log keeps the technical detail.
export const REWRITE_TEXT = {
  gone: "La richiesta di riscrittura non esiste più.",
  takeGone: "La versione da riscrivere non esiste più.",
  limits:
    "La parte deve durare da 10 a 30 secondi e al massimo metà del brano.",
  kieKey: "Su questo PC manca la chiave di kie.",
  kieBalance: (credits: number) =>
    `Il saldo kie è di ${credits} crediti: ne servono ${KIE_CREDITS.replace}. Nessun credito è stato usato.`,
  kieRefused:
    "kie ha rifiutato la richiesta: nessun credito è stato usato. Guarda il log del lavoro.",
  kieUnknown:
    "Non so se kie ha ricevuto la richiesta: controlla la dashboard di kie prima di riprovare.",
  kieFailed: "kie non è riuscito a rifare la parte. Riprova più tardi.",
  kieEmpty: "kie non ha restituito nessuna alternativa.",
  noInput: "Questo worker non sa dove ComfyUI legge l'audio.",
};

// kie keeps generated tracks for 14 days; after that a replace on its task id cannot work.
export const KIE_RETENTION_MS = 14 * 24 * 3600 * 1000;
// A track of about the take's length is the whole song with the part replaced; anything shorter
// is the part alone.
const FULL_SONG_SLACK = 3;

// The local full-quality file of a kept alternative (takeAudio reads it for a "replace" take).
export function sectionFile(
  outDir: string,
  editId: string,
  alternative: number,
): string {
  return join(outDir, "sections", `${editId}-${alternative + 1}.mp3`);
}

type Made = { file: string; kie_task_id?: string; kie_audio_id?: string };

function packOf(context: StageContext) {
  const parsed = LyricPackSchema.safeParse(context.version.lyric_pack);
  const pack = parsed.success ? parsed.data : null;
  return {
    title: (pack?.title || context.project.topic || "Song").slice(0, 80),
    style: pack?.style || context.project.style || "",
    exclude: pack?.exclude ?? "",
    model: pack?.settings.model ?? "V6",
    vocalGender: pack?.settings.vocalGender,
  };
}

// The kie task and track of a take, from the row or from the workspace's takes.json of that take's
// generation (stored on the take once found).
export async function kieIdsOf(
  context: StageContext,
  take: Take,
): Promise<{ taskId: string; audioId: string } | null> {
  if (take.engine !== "kie" || !take.kie_task_id) return null;
  if (
    take.created_at &&
    Date.now() - Date.parse(take.created_at) > KIE_RETENTION_MS
  )
    return null;
  if (take.kie_audio_id)
    return { taskId: take.kie_task_id, audioId: take.kie_audio_id };
  const n = take.take_number ?? 0;
  if (n < 1 || n > 2) return null;
  const generation = take.generation ?? 1;
  const files = [
    join(context.ws.outDir, `gen-${generation}`, "takes.json"),
    ...(generation ===
    (context.version.kie_generation ?? context.version.generation_count ?? 1)
      ? [join(context.ws.outDir, "takes.json")]
      : []),
  ];
  for (const file of files) {
    try {
      const tracks = JSON.parse(await readFile(file, "utf8")) as {
        id?: unknown;
      }[];
      const id = tracks[n - 1]?.id;
      if (typeof id === "string" && id) {
        await context.db.patchTake(take.id, { kie_audio_id: id });
        return { taskId: take.kie_task_id, audioId: id };
      }
    } catch {
      /* Not this file. */
    }
  }
  return null;
}

async function kieAlternatives(
  context: StageContext,
  edit: SectionEdit,
  take: Take,
  source: string,
  duration: number,
  dir: string,
): Promise<Made[]> {
  const key = context.secrets.values.KIE_API_KEY ?? "";
  if (!key) throw new Error(REWRITE_TEXT.kieKey);
  const client = new KieClient(key);
  let taskId = edit.kie_task_id ?? null;
  if (!taskId) {
    if (edit.kie_submit_state === "submitting")
      throw new Error(REWRITE_TEXT.kieUnknown);
    const balance = await client.credits();
    if (balance < KIE_CREDITS.replace)
      throw new Error(REWRITE_TEXT.kieBalance(balance));
    const pack = packOf(context);
    const ids = await kieIdsOf(context, take);
    let target: Record<string, unknown>;
    if (ids) target = { task_id: ids.taskId, audio_id: ids.audioId };
    else {
      // Any other take goes to kie as a file (its free upload), with the song's model.
      await context.progress(10, "Riscrittura: invio l'audio a kie");
      const mp3 = join(dir, "source-for-kie.mp3");
      await encode(context, source, mp3, { mp3: 320 });
      target = {
        upload_url: await client.upload(mp3, "audio/mpeg"),
        model: pack.model,
      };
    }
    const input = {
      ...target,
      prompt: edit.section_lyrics,
      lyrics: edit.section_lyrics,
      full_lyrics: edit.full_lyrics,
      tags: pack.style.slice(0, 1000),
      title: pack.title,
      ...(pack.exclude ? { negative_tags: pack.exclude } : {}),
      ...(pack.vocalGender ? { vocal_gender: pack.vocalGender } : {}),
      infill_start_s: Number(edit.start_s.toFixed(2)),
      infill_end_s: Number(edit.end_s.toFixed(2)),
    };
    await context.db.patchSectionEdit(edit.id, {
      kie_submit_state: "submitting",
    });
    try {
      taskId = await client.createTask({
        model: "ai-music-api/replace-section",
        input,
      });
    } catch (error) {
      if (error instanceof KieRefused) {
        await context.db.patchSectionEdit(edit.id, { kie_submit_state: null });
        await context.log(context.secrets.redact(error.message));
        throw new Error(REWRITE_TEXT.kieRefused);
      }
      throw new Error(REWRITE_TEXT.kieUnknown);
    }
    await context.db.patchSectionEdit(edit.id, {
      kie_task_id: taskId,
      kie_submit_state: "submitted",
    });
    await context.log(`kie replace-section task ${taskId}`);
  }
  await context.progress(30, "Riscrittura: kie rifà la parte");
  let tracks: KieTrack[];
  try {
    ({ tracks } = await client.wait(taskId, {
      signal: context.signal,
      onState: (state) => void context.log(`kie: ${state}`).catch(() => {}),
    }));
  } catch (error) {
    if (error instanceof KieFailed) {
      await context.log(context.secrets.redact(error.message));
      throw new Error(REWRITE_TEXT.kieFailed);
    }
    throw error;
  }
  if (tracks.length === 0) throw new Error(REWRITE_TEXT.kieEmpty);
  const made: Made[] = [];
  for (const [i, track] of tracks.slice(0, 4).entries()) {
    await context.progress(
      70 + i * 5,
      `Riscrittura: scarico l'alternativa ${i + 1}`,
    );
    const raw = join(dir, `kie-${i + 1}.mp3`);
    await client.download(track.url, raw, context.signal);
    const seconds = track.duration ?? (await probeSeconds(context, raw));
    let file = raw;
    if (Math.abs(seconds - duration) > FULL_SONG_SLACK) {
      // Only the part came back: it goes in at the part's start.
      file = join(dir, `kie-${i + 1}-song.flac`);
      await splice(context, source, raw, file, {
        start: edit.start_s,
        end: edit.end_s,
        duration,
        offset: edit.start_s,
        crossfade: REWRITE_CROSSFADE,
        gainDb: 0,
      });
    }
    made.push({
      file,
      kie_task_id: taskId,
      ...(track.id ? { kie_audio_id: track.id } : {}),
    });
  }
  return made;
}

async function aceAlternatives(
  context: StageContext,
  edit: SectionEdit,
  take: Take,
  source: string,
  duration: number,
  dir: string,
): Promise<Made[] | StageResult> {
  const ownerId = context.version.owner_id ?? context.project.owner_id;
  const role = ownerId ? await context.db.getOwnerRole(ownerId) : null;
  if (role !== "admin") throw new Error(LOCAL_TEXT.adminOnly);
  const runtime = context.comfy;
  if (!runtime) throw new Error(LOCAL_TEXT.unavailable);
  if (!runtime.inputDir) throw new Error(REWRITE_TEXT.noInput);
  const limits = { ...LOCAL_LIMITS, ...runtime.limits };
  if (!(await runtime.supervisor.isUp())) {
    const free = await runtime.freeVramMb().catch(() => null);
    if (free !== null && free < limits.minFreeVramMb) {
      await context.log(`Only ${free} MB of VRAM free, waiting`);
      return {
        retryLater: {
          reason: LOCAL_TEXT.busyGpu,
          notBefore: new Date(Date.now() + limits.retryLaterMs).toISOString(),
        },
      };
    }
  }
  const window = rewriteWindow(edit.start_s, edit.end_s, duration);
  const seconds = Math.round((window.to - window.from) * 100) / 100;
  const relative = `mellodifai/${edit.id}-window.flac`;
  const windowFile = join(runtime.inputDir, ...relative.split("/"));
  await mkdir(join(runtime.inputDir, "mellodifai"), { recursive: true });
  await encode(context, source, join(dir, "window.flac"), "flac", window);
  await copyFile(join(dir, "window.flac"), windowFile);
  const lyrics = windowLyrics(
    parseLyricTiming(take.lyric_timing),
    edit.old_lyrics,
    window,
    edit.section_lines,
    edit.section_lyrics,
  );
  const pack = packOf(context);
  const controls = readControls(context.project.song_settings);
  const drafted = bpmAndKey(pack.style);
  const seeds = await takeSeeds(context);
  const run = new LocalGeneration(context, runtime, "ace-step", {
    label: (n) => `Alternativa ${n} di 2 con ACE-Step`,
    total: 2,
  });
  const template = await loadGraph("ace-step");
  const parts: string[] = [];
  try {
    await context.log("Starting ComfyUI for ACE-Step");
    await runtime.supervisor.ensureStarted();
    await run.checkNodes(AUDIO_INPUT_NODES);
    for (const n of [1, 2]) {
      const prefix = `mellodifai/${context.version.id}/rewrite/${edit.id}-${n}`;
      const graph = withSourceAudio(
        aceGraph(template, {
          style: styleWithout(pack.style, controls),
          lyrics,
          seed: seeds[n - 1] ?? 0,
          duration: seconds,
          bpm: controls.bpm ?? drafted.bpm,
          keyscale: controls.keyscale ?? drafted.keyscale,
          ...(controls.timeSignature
            ? { timesignature: controls.timeSignature }
            : {}),
          language: language(context),
          prefix,
        }),
        { audio: relative, denoise: ACE_REWRITE_DENOISE },
      );
      const flac = join(dir, `ace-${n}.flac`);
      await run.render(graph, `${edit.id}:${n}`, prefix, flac, n);
      parts.push(flac);
    }
  } finally {
    try {
      await runtime.supervisor.stop();
    } catch (error) {
      await context
        .log(context.secrets.redact(`ComfyUI stop failed: ${String(error)}`))
        .catch(() => {});
    }
    await rm(windowFile, { force: true }).catch(() => {});
  }
  const made: Made[] = [];
  for (const [i, part] of parts.entries()) {
    await context.progress(
      90 + i * 2,
      `Riscrittura: inserisco l'alternativa ${i + 1}`,
    );
    const gainDb = await matchGain(
      context,
      source,
      part,
      edit.start_s,
      edit.end_s,
      window.from,
    );
    const file = join(dir, `ace-${i + 1}-song.flac`);
    await splice(context, source, part, file, {
      start: edit.start_s,
      end: edit.end_s,
      duration,
      offset: window.from,
      crossfade: REWRITE_CROSSFADE,
      gainDb,
    });
    made.push({ file });
  }
  return made;
}

export const replaceSection: StageHandler = async (context) => {
  const payload = (context.job.payload ?? {}) as { edit_id?: unknown };
  const edit =
    typeof payload.edit_id === "string"
      ? await context.db.getSectionEdit(payload.edit_id)
      : null;
  if (!edit || edit.version_id !== context.version.id)
    throw new Error(REWRITE_TEXT.gone);
  if (edit.alternatives.length > 0) {
    await context.log("Alternative già pronte per questa richiesta");
    return {};
  }
  const take = (await context.db.getTakes(context.version.id)).find(
    (item) => item.id === edit.take_id,
  );
  if (!take) throw new Error(REWRITE_TEXT.takeGone);
  const dir = join(context.ws.root, "sections", edit.id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    await context.progress(2, "Riscrittura: preparo l'audio");
    const source = await takeAudio(context, take, dir);
    const duration = await probeSeconds(context, source);
    if (sectionProblem(edit.start_s, edit.end_s, duration))
      throw new Error(REWRITE_TEXT.limits);
    const made =
      edit.engine === "kie"
        ? await kieAlternatives(context, edit, take, source, duration, dir)
        : await aceAlternatives(context, edit, take, source, duration, dir);
    if (!Array.isArray(made)) return made;
    const timing = rewrittenTiming(
      parseLyricTiming(take.lyric_timing),
      edit.old_lyrics,
      edit.full_lyrics,
    );
    const alternatives: SectionAlternative[] = [];
    await mkdir(join(context.ws.outDir, "sections"), { recursive: true });
    for (const [i, item] of made.entries()) {
      await context.progress(
        96 + i,
        `Riscrittura: carico l'alternativa ${i + 1}`,
      );
      // The full-quality copy stays on this PC for the video and the stems; the studio plays
      // the preview.
      const full = sectionFile(context.ws.outDir, edit.id, i);
      await encode(context, item.file, full, { mp3: 320 });
      const preview = join(dir, `section-${edit.id.slice(0, 8)}-${i + 1}.mp3`);
      await encode(context, item.file, preview, { mp3: 128 });
      alternatives.push({
        path: await upload(context, preview, "audio/mpeg"),
        duration:
          Math.round((await probeSeconds(context, full)) * 100) / 100 ||
          duration,
        ...(item.kie_task_id ? { kie_task_id: item.kie_task_id } : {}),
        ...(item.kie_audio_id ? { kie_audio_id: item.kie_audio_id } : {}),
        ...(timing ? { lyric_timing: timing } : {}),
      });
    }
    await context.db.patchSectionEdit(edit.id, { alternatives });
    await context.progress(100, "Alternative pronte");
    return {};
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};
