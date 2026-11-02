// R2 (master design 8.4): music (Demucs stems, beat_this beats, structure, key, energy,
// vocal type), a meaning map per section (abstract, never quoted lines) and the video
// blueprint (design 9.1) from the contact sheets by one vision call. On pass the source
// audio and video are deleted (design 14.3); the analysis JSON and contact sheets stay.
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLUEPRINT_VOCALS,
  type Blueprint,
  BlueprintSchema,
  type BlueprintShot,
  CAMERA_MOVES,
  IMAGE_NEEDS,
  type IngestManifest,
  IngestManifestSchema,
  KINETIC_TEXT,
  type MeaningEntry,
  OVERLAY_KINDS,
  type RemakeAnalysis,
  RemakeAnalysisSchema,
  SHOT_LAYOUTS,
  TRANSITIONS,
  TYPE_CASES,
  TYPE_POSITIONS,
  TYPE_WEIGHTS,
  TYPOGRAPHY_ROLES,
} from "@mellodifai/shared";
import { analyseLines, buildSections } from "./align.js";
import type { Env } from "./env.js";
import {
  type Client,
  type ContentPart,
  DEFAULT_MODELS,
  type Models,
} from "./openrouter.js";
import { longestSharedRun } from "./originality.js";
import { ENGINE_ROOT, PYTHON, STEMS_PYTHON } from "./paths.js";
import { run as defaultRun, type Run, runChecked } from "./run.js";
import {
  buildShots,
  classifyVocal,
  type ShotSkeleton,
  sheetCells,
} from "./shots.js";
import { deriveStyleTags } from "./style.js";

const PY_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "python");
// Design 8.4: one vision call, at most 12 contact sheets, budget 0.01 USD.
export const MAX_SHEETS = 12;
export const BLUEPRINT_BUDGET_USD = 0.01;

export type AnalyseOptions = {
  env: Env;
  client: Client;
  run?: Run;
  log?: (line: string) => void;
  models?: Partial<Models>;
  stems?: boolean;
  keepMedia?: boolean;
  force?: boolean;
  python?: string;
  stemsPython?: string;
  engineRoot?: string;
};

type MusicJson = {
  duration: number;
  bpm: number;
  beatTracker: string;
  beats: number[];
  downbeats: number[];
  beatsPerBar: number;
  meterConfidence: number;
  boundaries: number[];
  labels: string[];
  energy: { t: number; v: number }[];
  stemShares: {
    vocals: number;
    drums: number;
    bass: number;
    other: number;
  } | null;
  vocal: {
    medianF0Hz: number | null;
    voicedShare: number | null;
    pitchStability: number | null;
    lowShare: number | null;
    highShare: number | null;
  } | null;
};

export function parseKey(top: unknown): {
  tonic: string;
  mode: "major" | "minor";
  confidence: number;
} {
  const first = Array.isArray(top) ? (top[0] as unknown[]) : null;
  const m = /^([A-G]#?)\s+(major|minor)$/u.exec(String(first?.[0] ?? ""));
  return m?.[1] && m[2]
    ? {
        tonic: m[1],
        mode: m[2] as "major" | "minor",
        confidence: Number(first?.[1] ?? 0),
      }
    : { tonic: "C", mode: "major", confidence: 0 };
}

export function protectedNamesOf(
  manifest: IngestManifest,
  names: string[],
): string[] {
  const title = manifest.title
    .replace(
      /[([][^)\]]*(?:official|video|lyric|audio|visualizer)[^)\]]*[)\]]/giu,
      "",
    )
    .trim();
  const parts = title.split(/\s+[-|:]\s+/u).map((p) => p.trim());
  return [
    ...new Set(
      [manifest.uploader, ...names, title, ...parts].filter(
        (n) => n && n.length >= 2,
      ),
    ),
  ];
}

const pick = <T extends string>(
  values: readonly T[],
  v: unknown,
  fallback: T,
): T =>
  (values as readonly string[]).includes(String(v)) ? (v as T) : fallback;
const hexes = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : [])
    .map(String)
    .filter((x) => /^#[0-9a-f]{6}$/iu.test(x))
    .slice(0, max);

type Look = Record<string, unknown>;

// One look from the vision reply, coerced into the blueprint's enums.
export function lookToShot(
  look: Look | undefined,
  skeleton: ShotSkeleton,
): BlueprintShot {
  const motion = (look?.motion ?? {}) as Record<string, unknown>;
  const typography = Array.isArray(look?.typographyRoles)
    ? (look?.typographyRoles as Record<string, unknown>[])
    : [];
  const overlays = Array.isArray(look?.overlays)
    ? (look?.overlays as Record<string, unknown>[])
    : [];
  return {
    id: skeleton.id,
    sectionId: skeleton.sectionId,
    startS: skeleton.start,
    endS: skeleton.end,
    offsetInSection: skeleton.offsetInSection,
    layout: pick(SHOT_LAYOUTS, look?.layout, "full_bleed"),
    typographyRoles: typography.slice(0, 4).map((t) => ({
      role: pick(TYPOGRAPHY_ROLES, t.role, "lyric"),
      weight: pick(TYPE_WEIGHTS, t.weight, "bold"),
      case: pick(TYPE_CASES, t.case, "sentence"),
      position: pick(TYPE_POSITIONS, t.position, "center"),
    })),
    palette: hexes(look?.palette, 6),
    motion: {
      camera: pick(CAMERA_MOVES, motion.camera, "static"),
      cutOnBeat: skeleton.onBeat,
      kineticText: pick(KINETIC_TEXT, motion.kineticText, "none"),
      visualizer:
        typeof motion.visualizer === "string" && motion.visualizer.trim()
          ? motion.visualizer.slice(0, 40)
          : null,
    },
    transition: pick(TRANSITIONS, look?.transition, "cut"),
    overlays: overlays.slice(0, 6).map((o) => ({
      kind: pick(OVERLAY_KINDS, o.kind, "shape"),
      position: String(o.position ?? "center").slice(0, 30),
    })),
    imageNeed: pick(IMAGE_NEEDS, look?.imageNeed, "background"),
  };
}

function enumList(name: string, values: readonly string[]) {
  return `${name}: ${values.join(" | ")}`;
}

async function sheetImages(
  manifest: IngestManifest,
): Promise<{ parts: ContentPart[]; used: number[] }> {
  const sheets = manifest.frames.contactSheets;
  const step = Math.max(1, sheets.length / MAX_SHEETS);
  const used = [
    ...new Set(
      Array.from({ length: Math.min(MAX_SHEETS, sheets.length) }, (_, i) =>
        Math.floor(i * step),
      ),
    ),
  ];
  const parts: ContentPart[] = [];
  for (const k of used) {
    const sheet = sheets[k];
    if (!sheet || !existsSync(sheet.file)) continue;
    parts.push({
      type: "text",
      text: `Sheet ${k + 1}: ${sheet.start}-${sheet.end} s, ${sheet.cols}x${sheet.rows} cells, one frame per second, timestamp burned in.`,
    });
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${(await readFile(sheet.file)).toString("base64")}`,
      },
    });
  }
  return { parts, used };
}

export async function analyse(
  dir: string,
  options: AnalyseOptions,
): Promise<RemakeAnalysis> {
  const runner = options.run ?? defaultRun;
  const log = options.log ?? (() => {});
  const models: Models = { ...DEFAULT_MODELS, ...options.models };
  const client = options.client;
  const mark = client.ledger.calls.length;
  const python = options.python ?? PYTHON;
  const stemsPython = options.stemsPython ?? STEMS_PYTHON;
  const manifest = IngestManifestSchema.parse(
    JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")),
  );
  const names = existsSync(join(dir, "names.json"))
    ? (JSON.parse(await readFile(join(dir, "names.json"), "utf8")) as string[])
    : [];
  const audio = manifest.files.audio;
  if (!existsSync(audio))
    throw new Error(`source audio missing (${audio}); run ingest again`);
  const fresh = (path: string) => options.force || !existsSync(path);
  const checked = (
    cmd: string,
    args: string[],
    what: string,
    timeoutMs = 20 * 60_000,
  ) =>
    runChecked(runner, cmd, args, {
      what,
      timeoutMs,
      redact: options.env.redact,
    });
  const haveStemsVenv = existsSync(stemsPython);

  // Stems on the CPU (the venv's torch is a CPU build; -d cpu makes it explicit).
  const stemsDir = join(dir, "stems", "htdemucs", "audio");
  if (
    options.stems !== false &&
    haveStemsVenv &&
    fresh(join(stemsDir, "vocals.wav"))
  ) {
    log("analyse: Demucs stems (CPU)");
    await checked(
      stemsPython,
      [
        "-I",
        "-m",
        "demucs",
        "-n",
        "htdemucs",
        "--shifts=0",
        "-d",
        "cpu",
        "-o",
        join(dir, "stems"),
        audio,
      ],
      "demucs",
    );
  }
  const beatsPath = join(dir, "beats.json");
  if (haveStemsVenv && fresh(beatsPath)) {
    log("analyse: beats and downbeats (beat_this)");
    await checked(
      stemsPython,
      ["-I", join(PY_DIR, "beats.py"), audio, beatsPath],
      "beats.py",
    );
  }
  const musicPath = join(dir, "music.json");
  if (fresh(musicPath)) {
    log("analyse: structure, meter, energy, vocal");
    await checked(
      python,
      [
        "-I",
        join(PY_DIR, "music.py"),
        audio,
        musicPath,
        ...(existsSync(beatsPath) ? ["--beats", beatsPath] : []),
        ...(existsSync(join(stemsDir, "vocals.wav"))
          ? ["--stems", stemsDir]
          : []),
      ],
      "music.py",
    );
  }
  const dnaPath = join(dir, "audio-dna.json");
  if (fresh(dnaPath)) {
    log("analyse: key (suno-remake tools/analyze_audio.py)");
    await checked(
      python,
      [
        "-I",
        join(options.engineRoot ?? ENGINE_ROOT, "tools", "analyze_audio.py"),
        audio,
        dnaPath,
      ],
      "analyze_audio.py",
    );
  }
  const music = JSON.parse(await readFile(musicPath, "utf8")) as MusicJson;
  const dna = JSON.parse(await readFile(dnaPath, "utf8")) as {
    key_global_top4?: unknown;
  };

  const durationS = manifest.durationS || music.duration;
  const sections = buildSections({
    durationS,
    boundaries: music.boundaries,
    labels: music.labels,
    lines: manifest.transcript.lines,
    downbeats: music.downbeats,
    energy: music.energy,
  });
  const lines = analyseLines(
    manifest.transcript.lines,
    sections,
    music.beats,
    manifest.language,
  );
  const protectedNames = protectedNamesOf(manifest, names);

  // Meaning map: abstract descriptions per sung section, plus genre and mood.
  const lyricIds = sections
    .filter((s) => lines.some((l) => l.sectionId === s.id))
    .map((s) => s.id);
  type MeaningReply = {
    overall?: {
      genre?: unknown;
      mood?: unknown;
      summary?: unknown;
      instrumentation?: unknown;
      vocal?: unknown;
    };
    sections?: Partial<MeaningEntry>[];
  };
  const meaningUser = [
    `Video title: ${manifest.title}`,
    `Tags: ${manifest.tags.slice(0, 15).join(", ")}`,
    `Measured: ${Math.round(music.bpm)} BPM, ${parseKey(dna.key_global_top4).tonic} ${parseKey(dna.key_global_top4).mode}, stems share ${JSON.stringify(music.stemShares)}`,
    "",
    ...sections.map((s) => {
      const ls = lines.filter((l) => l.sectionId === s.id);
      return [
        `## ${s.id} (${s.label}, ${s.start.toFixed(1)}-${s.end.toFixed(1)} s)`,
        ...ls.map((l) => `${l.index}. ${l.text}`),
      ].join("\n");
    }),
  ].join("\n");
  const meaningSystem = [
    "ROLE: song analyst.",
    "Describe what each sung section means, as abstract descriptions in English: never quote or paraphrase a line closely, never use names of people, artists, places or brands.",
    `Reply with JSON only: {"overall": {"genre": [up to 3 short genre words], "mood": [up to 3 mood words], "summary": one sentence about the song's story without names, "instrumentation": [up to 8 instruments you would expect to hear], "vocal": one of ${BLUEPRINT_VOCALS.join(", ")}}, "sections": [{"sectionId": id, "theme": string, "storyBeat": string, "imagery": [short abstract images], "emotionalArc": string, "hookIdea": string}]}.`,
    `Give one entry for each of these sections: ${lyricIds.join(", ")}.`,
  ].join("\n");
  let reply: MeaningReply = {};
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    reply = await client.chatJson<MeaningReply>({
      step: "meaning-map",
      model: models.analyst,
      system: meaningSystem,
      user: problems.length
        ? `${meaningUser}\n\nYour previous reply was rejected: ${problems.join("; ")}`
        : meaningUser,
      temperature: 0.3,
      maxTokens: 2500,
    });
    problems = [];
    for (const id of lyricIds) {
      const e = reply.sections?.find((x) => x?.sectionId === id);
      if (!e?.theme || !e.storyBeat || !e.emotionalArc)
        problems.push(`section ${id} is missing or incomplete`);
      const text = e
        ? [
            e.theme,
            e.storyBeat,
            ...(Array.isArray(e.imagery) ? e.imagery : []),
            e.emotionalArc,
            e.hookIdea,
          ].join(" ")
        : "";
      const quoted = lines.find((l) => longestSharedRun(text, l.text) >= 4);
      if (quoted)
        problems.push(
          `section ${id} quotes the line "${quoted.text}": describe it abstractly`,
        );
      const named = protectedNames.find(
        (n) => n.length >= 3 && text.toLowerCase().includes(n.toLowerCase()),
      );
      if (named) problems.push(`section ${id} names "${named}"`);
    }
    if (problems.length === 0) break;
    log(`meaning map rejected: ${problems.join("; ")}`);
  }
  if (problems.length)
    throw new Error(`meaning map failed validation: ${problems.join("; ")}`);
  const stringList = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : [])
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, max);
  const meaning: MeaningEntry[] = lyricIds.map((id) => {
    const e = reply.sections?.find((x) => x?.sectionId === id) ?? {};
    return {
      sectionId: id,
      theme: String(e.theme),
      storyBeat: String(e.storyBeat),
      imagery: stringList(e.imagery, 8),
      emotionalArc: String(e.emotionalArc),
      hookIdea: typeof e.hookIdea === "string" ? e.hookIdea : "",
    };
  });
  const overall = {
    genre: stringList(reply.overall?.genre, 3),
    mood: stringList(reply.overall?.mood, 3),
    summary:
      typeof reply.overall?.summary === "string" ? reply.overall.summary : "",
  };

  const measured = classifyVocal(
    music.vocal,
    music.stemShares,
    lines.length > 0,
  );
  const vocalType =
    measured.type ?? pick(BLUEPRINT_VOCALS, reply.overall?.vocal, "none");
  const stemTags = music.stemShares
    ? [
        music.stemShares.drums >= 0.15 ? "drums" : null,
        music.stemShares.bass >= 0.3
          ? "prominent bass"
          : music.stemShares.bass >= 0.1
            ? "bass"
            : null,
      ].filter((t): t is string => Boolean(t))
    : [];
  const instrumentation = [
    ...new Set([...stemTags, ...stringList(reply.overall?.instrumentation, 8)]),
  ].slice(0, 12);
  const key = parseKey(dna.key_global_top4);
  const musicAnalysis: RemakeAnalysis["music"] = {
    durationS,
    bpm: Math.round(music.bpm * 100) / 100,
    beatTracker: music.beatTracker,
    key,
    timeSignature: {
      beatsPerBar: music.beatsPerBar,
      confidence: Math.min(1, Math.max(0, music.meterConfidence)),
    },
    beats: music.beats,
    downbeats: music.downbeats,
    sections,
    vocal: {
      type: vocalType,
      delivery: measured.delivery,
      medianF0Hz: music.vocal?.medianF0Hz ?? null,
      voicedShare: music.vocal?.voicedShare ?? null,
      pitchStability: music.vocal?.pitchStability ?? null,
      notes: measured.type
        ? "measured on the Demucs vocal stem"
        : "vocal range undecided by measurement: the analyst's guess",
    },
    instrumentation: {
      stemShares: music.stemShares,
      inferred: instrumentation,
    },
    energy: music.energy,
  };

  // Blueprint: shot timing from all cuts; the look from one vision call.
  const skeleton = buildShots({
    cuts: manifest.frames.cutTimes,
    beats: music.beats,
    sections,
    durationS,
  });
  const { parts, used } = await sheetImages(manifest);
  const sectionOf = new Map(sections.map((s) => [s.id, s]));
  const visionUser: ContentPart[] = [
    {
      type: "text",
      text: [
        `The source video lasts ${durationS.toFixed(1)} s. Its shots (timing is fixed; describe only the look):`,
        ...skeleton.map(
          (s) =>
            `${s.id} ${s.start.toFixed(2)}-${s.end.toFixed(2)} s, ${sectionOf.get(s.sectionId)?.label ?? s.sectionId}, ${sheetCells(s.start, s.end)}`,
        ),
        `Contact sheets attached: ${used.map((k) => k + 1).join(", ")} of ${manifest.frames.contactSheets.length}.`,
      ].join("\n"),
    },
    ...parts,
  ];
  const visionSystem = [
    "ROLE: motion and graphic designer reading a music video.",
    "Describe the video's visual language as style descriptors only: never transcribe on-screen text, never name fonts, brands, people or the artist.",
    "Group the shots into at most 8 recurring looks and give each shot its look.",
    "Each look: {" +
      [
        enumList('"layout"', SHOT_LAYOUTS),
        '"typographyRoles": up to 4 of {"role", "weight", "case", "position"}',
        enumList("role", TYPOGRAPHY_ROLES),
        enumList("weight", TYPE_WEIGHTS),
        enumList("case", TYPE_CASES),
        enumList("position", TYPE_POSITIONS),
        '"palette": up to 6 "#rrggbb"',
        `"motion": {${enumList('"camera"', CAMERA_MOVES)}, ${enumList('"kineticText"', KINETIC_TEXT)}, "visualizer": short description or null}`,
        enumList('"transition"', TRANSITIONS),
        `"overlays": up to 6 of {${enumList('"kind"', OVERLAY_KINDS)}, "position": short}`,
        enumList('"imageNeed"', IMAGE_NEEDS),
      ].join("; ") +
      "}",
    'Reply with JSON only: {"global": {"palette": up to 8 "#rrggbb", "typeScale": {"basePx": number, "ratio": number}}, "looks": {"a": look, "b": look}, "shotLooks": [one look key per shot, in order]}.',
  ].join("\n");
  const before = client.ledger.usd;
  const vision = await client.chatJson<{
    global?: {
      palette?: unknown;
      typeScale?: { basePx?: unknown; ratio?: unknown };
    };
    looks?: Record<string, Look>;
    shotLooks?: unknown;
  }>({
    step: "blueprint:vision",
    model: models.vision,
    system: visionSystem,
    user: visionUser,
    temperature: 0.2,
    maxTokens: 2500,
  });
  const visionCost = client.ledger.usd - before;
  if (visionCost > BLUEPRINT_BUDGET_USD)
    log(
      `warning: blueprint vision call cost ${visionCost.toFixed(4)} USD, over the ${BLUEPRINT_BUDGET_USD} USD budget`,
    );
  const looks = vision.looks ?? {};
  const keys = Object.keys(looks);
  const shotLooks = Array.isArray(vision.shotLooks)
    ? vision.shotLooks.map(String)
    : [];
  const basePx = Number(vision.global?.typeScale?.basePx);
  const ratio = Number(vision.global?.typeScale?.ratio);
  const info = existsSync(manifest.files.info)
    ? (JSON.parse(await readFile(manifest.files.info, "utf8")) as {
        width?: number;
        height?: number;
      })
    : {};
  const portrait = Number(info.height ?? 0) > Number(info.width ?? 0);
  const blueprint: Blueprint = BlueprintSchema.parse({
    schemaVersion: 1,
    source: {
      videoId: manifest.videoId,
      url: manifest.url,
      durationS,
      analysedAt: new Date().toISOString(),
    },
    music: {
      bpm: musicAnalysis.bpm,
      key: `${key.tonic} ${key.mode}`,
      timeSig: `${music.beatsPerBar}/4`,
      sections: sections.map((s) => ({
        id: s.id,
        label: s.kind,
        startS: s.start,
        endS: s.end,
        energy: s.energy,
        bars: Math.max(
          1,
          music.downbeats.filter((d) => d >= s.start - 0.05 && d < s.end - 0.05)
            .length,
        ),
      })),
      downbeatsS: music.downbeats,
      vocal: vocalType,
      instrumentation,
    },
    shots: skeleton.map((s, i) =>
      lookToShot(looks[shotLooks[i] ?? ""] ?? looks[keys[0] ?? ""], s),
    ),
    global: {
      palette: hexes(vision.global?.palette, 8),
      aspect: portrait ? "9:16" : "16:9",
      typeScale: {
        basePx:
          Number.isFinite(basePx) && basePx > 8 && basePx < 400 ? basePx : 48,
        ratio: Number.isFinite(ratio) && ratio > 1 && ratio < 3 ? ratio : 1.25,
      },
    },
  });

  const analysis: RemakeAnalysis = RemakeAnalysisSchema.parse({
    schemaVersion: 1,
    videoId: manifest.videoId,
    url: manifest.url,
    title: manifest.title,
    protectedNames,
    sourceLanguage: manifest.language,
    music: musicAnalysis,
    lines,
    meaning,
    overall,
    blueprint,
    styleTags: deriveStyleTags(musicAnalysis, overall, protectedNames),
    cost: client.ledger.since(mark),
    sourceMediaDeleted: false,
  });

  // R2 passed: the source media go (analysis only, AC10); JSON and contact sheets stay.
  if (!options.keepMedia) {
    const media = [
      manifest.files.audio,
      ...(manifest.files.video ? [manifest.files.video] : []),
      join(dir, "stems"),
      ...manifest.frames.sceneCuts.map((c) => c.file),
    ];
    for (const path of media) await rm(path, { recursive: true, force: true });
    for (const f of await readdir(dir))
      if (/^(?:audio|video)\./u.test(f))
        await rm(join(dir, f), { force: true });
    analysis.sourceMediaDeleted = true;
  }
  await writeFile(
    join(dir, "analysis.json"),
    JSON.stringify(analysis, null, 1),
  );
  await writeFile(
    join(dir, "blueprint.json"),
    JSON.stringify(blueprint, null, 1),
  );
  return analysis;
}
