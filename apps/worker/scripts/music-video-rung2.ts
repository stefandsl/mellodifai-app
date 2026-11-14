// Rung 2 of the music-video line, without the database: performer and set bible, three shots
// (one lip-sync close-up, one burst, one previz-driven instrumental shot) drafted with Seedance
// 2.5 via kie, automated gates on each draft, 1080p only for passing drafts within a hard credit
// cap, and the assembly of the generated shots into the rung-1 previz.
//
//   tsx scripts/music-video-rung2.ts --rung1 <rung1 folder> --timing timing.json
//     --master master.wav --out <rung2 folder> --env <worker.env> [--cap 5000] [--paid]
//
// Without --paid it does every free step (plan, prompts, black-picture audio videos, previz
// references, cost estimate, balance check, ledger header) and stops before the first paid call.
// With --paid it still stops, and says by how much, when the kie balance or the cap cannot cover
// the next phase: topping up is the owner's decision. Every paid call is reserved in
// <out>/ledger.tsv before it is made and settled with what kie charged.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  bibleFor,
  type CutPlan,
  type DraftMeasurements,
  evaluateDraftGates,
  GATE_THRESHOLDS,
  generationPrompt,
  insideWord,
  parseSceneCuts,
  type Shot,
  type ShotKind,
  type ShotList,
} from "@mellodifai/shared";
import { TsvCapLedger } from "../src/providers/cap-ledger.js";
import { KieClient } from "../src/providers/kie-client.js";
import {
  KIE_PRICES,
  runMediaTask,
  SEEDANCE,
  SEEDANCE_UPGRADE,
  SEEDREAM_I2I,
  SEEDREAM_T2I,
  seedanceCredits,
  seedanceDraftBody,
  seedanceSeconds,
  seedanceUpgradeBody,
  seedreamBody,
  seedreamCredits,
} from "../src/providers/kie-media.js";
import { openPaidEntry } from "../src/providers/paid.js";
import {
  assembleArgs,
  blackVideoArgs,
  concatList,
  fitClipArgs,
  sceneCutArgs,
  syncCheck,
  withReplacements,
} from "../src/stages/music-video.js";

const { values } = parseArgs({
  options: {
    rung1: { type: "string" },
    timing: { type: "string" },
    master: { type: "string" },
    out: { type: "string" },
    env: { type: "string" },
    cap: { type: "string", default: "5000" },
    paid: { type: "boolean", default: false },
    python: {
      type: "string",
      default: "E:/mellodifai/venvs/music-video-gates/Scripts/python.exe",
    },
  },
});
if (!values.rung1 || !values.timing || !values.master || !values.out) {
  console.error(
    "usage: --rung1 <dir> --timing <timing.json> --master <wav> --out <dir> [--env <file>] [--paid]",
  );
  process.exit(1);
}
const rung1 = resolve(values.rung1);
const out = resolve(values.out);
const master = resolve(values.master);
const cap = Number(values.cap);
const pyDir = resolve(import.meta.dirname, "../python");
for (const d of [
  "audio",
  "refs",
  "images",
  "drafts",
  "finals",
  "fit",
  "scores",
])
  mkdirSync(join(out, d), { recursive: true });

function run(command: string, args: string[]): string {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(
      `${command} failed (${r.status}): ${(r.stderr || r.stdout || "").slice(-1500)}`,
    );
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}
const frames = (file: string) =>
  Number(
    run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_packets",
      "-show_entries",
      "stream=nb_read_packets",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]).trim(),
  );
const seconds = (file: string, stream: string) =>
  Number(
    run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      stream,
      "-show_entries",
      "stream=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]).trim(),
  );
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const save = (file: string, data: unknown) =>
  writeFile(join(out, file), `${JSON.stringify(data, null, 2)}\n`);

// The key goes from the owner's env file into this process only; it is never printed.
function loadKey(file: string | undefined): string {
  if (process.env.KIE_API_KEY) return process.env.KIE_API_KEY;
  if (!file || !existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .find((l) => l.startsWith("KIE_API_KEY="));
  return (line?.slice("KIE_API_KEY=".length) ?? "")
    .trim()
    .replace(/^["']|["']$/gu, "");
}

// ---------------------------------------------------------------- plan (free)
const cutPlan = json(join(rung1, "cutplan.json")) as CutPlan;
const shotList = json(join(rung1, "shotlist.json")) as ShotList;
const timing = json(values.timing) as {
  lines: { words: { start: number; end: number }[] }[];
};
const words = timing.lines.flatMap((l) => l.words);

// The three shots. Rung 1's plan cuts six boundaries 16 ms inside a word at frame time (fixed in
// the planner since); these shots were chosen among segments whose both frame cuts are clean.
type Pick = {
  index: number;
  kind: ShotKind;
  camera: Shot["camera"];
  set: "set-verse" | "set-chorus";
  costume: "costume-a" | "costume-b" | "costume-c";
  performer: boolean;
  video: "song-audio" | "previz";
};
const PICKS: Pick[] = [
  {
    index: 5,
    kind: "lipsync-single",
    camera: "close-up",
    set: "set-verse",
    costume: "costume-a",
    performer: true,
    video: "song-audio",
  },
  {
    index: 13,
    kind: "burst",
    camera: "orbit",
    set: "set-chorus",
    costume: "costume-b",
    performer: true,
    video: "song-audio",
  },
  {
    index: 24,
    kind: "instrumental-broll",
    camera: "overhead",
    set: "set-verse",
    costume: "costume-c",
    performer: false,
    video: "previz",
  },
];

const song = {
  title: "Va bene, passa",
  language: "Italian",
  genre: shotList.genre,
  story:
    "an ironic Italian office song about the AI chatbot the boss bought to cut costs; the singer is the employee promoted to 'bot caretaker' who approves everything it writes with 'va bene, passa' (looks good to me) while the code, the tests and the company fall apart.",
};
const costumes = {
  base: {
    id: "costume-a",
    outfit:
      "a fitted navy office blazer over a white shirt, slim black trousers, white sneakers, a red company lanyard with a plastic ID badge",
  },
  variants: [
    {
      id: "costume-b",
      outfit:
        "an Italo-disco stage outfit: a silver sequinned cropped jacket with big shoulders over a black top, high-waisted shiny black trousers, silver boots, the same red lanyard with the ID badge",
    },
    {
      id: "costume-c",
      outfit:
        "a lilac 1980s tracksuit with white stripes, white sneakers, the same red lanyard with the ID badge",
    },
  ],
};
const sets = {
  verse: {
    id: "set-verse",
    description:
      "A Milan open-plan office at night. Rows of white desks with monitors showing green check marks, a humming server rack in a glass closet that looks like a fridge, a ficus plant, blinds with city lights behind them, cold fluorescent light mixed with magenta and cyan monitor glow.",
  },
  chorus: {
    id: "set-chorus",
    description:
      "An Italo-disco stage built where the office ends: a mirrored dance floor with coloured light tiles, a giant LED wall at the back showing the night office from the verse set, office chairs and a desk pushed to the sides of the stage, haze, moving magenta and cyan beams.",
  },
};
const bible = bibleFor(
  song,
  costumes.base,
  costumes.variants,
  sets.verse,
  sets.chorus,
);

const fps = cutPlan.fps;
const shots = PICKS.map((p) => {
  const shot = shotList.shots[p.index] as Shot;
  const seg = cutPlan.segments[p.index];
  if (!seg || shot.kind !== p.kind)
    throw new Error(`segment ${p.index} is not a ${p.kind}`);
  for (const f of [seg.startFrame, seg.endFrame])
    if (insideWord(f / fps, words))
      throw new Error(`segment ${p.index} cuts a word at frame ${f}`);
  const target = seg.endFrame - seg.startFrame;
  const segSeconds = target / fps;
  const genSeconds = seedanceSeconds(segSeconds);
  const n = String(p.index + 1).padStart(2, "0");
  const refVideo =
    p.video === "song-audio"
      ? join(out, "audio", `segment-${n}-audio.mp4`)
      : join(out, "refs", `segment-${n}-previz.mp4`);
  const images = [
    ...(p.performer || p.kind === "instrumental-broll"
      ? [
          {
            role: "performer" as const,
            label: `the singer, wearing ${p.costume === "costume-a" ? "her office outfit" : p.costume === "costume-b" ? "her sequinned stage outfit" : "her lilac tracksuit"}`,
            file: join(out, "images", `${p.costume}.png`),
          },
        ]
      : []),
    {
      role: "set" as const,
      label:
        p.set === "set-verse"
          ? "the night office where she works"
          : "the disco stage with the office on its LED wall",
      file: join(out, "images", `${p.set}.png`),
    },
  ];
  const prompt = generationPrompt(
    { ...shot, camera: p.camera, kind: p.kind },
    song.genre,
    { images, video: p.video },
  );
  return {
    ...p,
    segment: p.index + 1,
    startFrame: seg.startFrame,
    endFrame: seg.endFrame,
    targetFrames: target,
    segmentSeconds: Math.round(segSeconds * 1000) / 1000,
    generateSeconds: genSeconds,
    lyrics: shot.lyrics,
    sung: seg.sung,
    burst: shot.burst,
    refVideo,
    images,
    prompt,
    draftCredits: seedanceCredits({
      resolution: "480p",
      outputSeconds: genSeconds,
      referenceVideoSeconds: segSeconds,
    }),
    finalCredits: seedanceCredits({
      resolution: "1080p",
      outputSeconds: genSeconds,
      referenceVideoSeconds: segSeconds,
    }),
  };
});

// Black-picture audio videos on the segment's frames, and the previz clip as a camera reference.
for (const s of shots) {
  if (s.video === "song-audio") {
    run(
      "ffmpeg",
      blackVideoArgs(
        master,
        {
          start: s.startFrame / fps,
          end: s.endFrame / fps,
          startFrame: s.startFrame,
          endFrame: s.endFrame,
        },
        s.refVideo,
        fps,
      ),
    );
  } else {
    copyFileSync(
      join(rung1, "clips", `segment-${String(s.segment).padStart(2, "0")}.mp4`),
      s.refVideo,
    );
  }
  const got = frames(s.refVideo);
  if (got !== s.targetFrames)
    throw new Error(
      `${s.refVideo}: ${got} frames, segment has ${s.targetFrames}`,
    );
}

const imageJobs = [
  { id: "costume-a", prompt: bible.performer.prompt, from: [] as string[] },
  ...bible.costumes.variants.map((v) => ({
    id: v.id,
    prompt: v.prompt,
    from: ["costume-a"],
  })),
  { id: "set-verse", prompt: bible.sets[0]?.prompt ?? "", from: [] },
  {
    id: "set-chorus",
    prompt: bible.sets[1]?.prompt ?? "",
    from: ["set-verse"],
  },
];
const imageCredits = seedreamCredits(imageJobs.length);
const draftCredits = shots.reduce((a, s) => a + s.draftCredits, 0);
// Finals in priority order, as many as the cap allows after images and every draft.
let held = imageCredits + draftCredits;
const finalsPlanned: number[] = [];
for (const s of shots)
  if (held + s.finalCredits <= cap) {
    held += s.finalCredits;
    finalsPlanned.push(s.index);
  }
const plan = {
  song: song.title,
  cap,
  prices: KIE_PRICES,
  bible,
  images: imageJobs.map((j) => ({
    ...j,
    model: j.from.length ? SEEDREAM_I2I : SEEDREAM_T2I,
    credits: KIE_PRICES.seedreamFlashPerImage,
  })),
  shots: shots.map(({ images, ...s }) => ({
    ...s,
    images: images.map((i) => ({ role: i.role, label: i.label, file: i.file })),
  })),
  estimate: {
    images: imageCredits,
    drafts: draftCredits,
    phase1: Math.round((imageCredits + draftCredits) * 100) / 100,
    finals: finalsPlanned.map((i) => ({
      shot: i,
      credits: shots.find((s) => s.index === i)?.finalCredits,
    })),
    finalsLeftOutByCap: shots
      .filter((s) => !finalsPlanned.includes(s.index))
      .map((s) => ({ shot: s.index, credits: s.finalCredits })),
    total: Math.round(held * 100) / 100,
  },
};
await save("plan.json", plan);
console.log(
  `plan: phase 1 (images + drafts) ${plan.estimate.phase1} credits, finals ${JSON.stringify(plan.estimate.finals)}, total ${plan.estimate.total} of cap ${cap}`,
);

// ---------------------------------------------------------------- balance and ledger
const ledger = new TsvCapLedger(join(out, "ledger.tsv"), cap, [
  `kie prices read ${KIE_PRICES.checked} from kie.ai/seedance-2-5 and kie.ai/seedream-5-0-flash (beta prices)`,
  `seedance 2.5 credits/s: 480p draft 17 with reference video (x (ref + output) s) or 28 without; 720p 38 / 63; 1080p 95 / 158; the 1080p upgrade of a draft keeps the draft's billing mode`,
  `seedream 5 flash (text to image and image edit, 1K-2K): ${KIE_PRICES.seedreamFlashPerImage} credits per image`,
  "estimates round every second up; the running total holds an open reservation at its estimate",
]);
const key = loadKey(values.env);
const client = key ? new KieClient(key) : null;
const balance = client ? await client.credits() : 0;
await ledger.note(
  `balance check (free call): ${balance} credits; plan needs ${plan.estimate.phase1} for images + drafts and ${plan.estimate.total} in total`,
);
const status: Record<string, unknown> = {
  balance,
  plan: plan.estimate,
  paidRequested: values.paid,
};
if (!values.paid || balance < plan.estimate.phase1) {
  const shortfall = Math.round((plan.estimate.phase1 - balance) * 100) / 100;
  const shortfallAll = Math.round((plan.estimate.total - balance) * 100) / 100;
  status.stopped = values.paid
    ? `balance ${balance} below the ${plan.estimate.phase1} credits images + drafts need: short by ${shortfall} (by ${shortfallAll} for the whole plan)`
    : "free run: no paid call made";
  if (values.paid)
    await ledger.note(`stopped before any paid call: ${status.stopped}`);
  await save("status.json", status);
  await save("gates.json", {
    thresholds: GATE_THRESHOLDS,
    drafts: shots.map((s) => ({
      shot: s.index,
      kind: s.kind,
      state: "not generated",
      reason: status.stopped,
    })),
    calibration: calibration(),
  });
  console.log(`stopped: ${String(status.stopped)}`);
  process.exit(0);
}

// ---------------------------------------------------------------- paid path
if (!client) throw new Error("no kie key");
const kie = client;

// One paid generation: reservation, submit, wait, download, settle with kie's own count (or the
// balance difference). A failed task is retried once, logged; a cap refusal stops the step.
async function generate(
  label: string,
  model: string,
  units: string,
  estimate: number,
  body: { model: string; input: Record<string, unknown> },
  file: string,
) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Throws a cap refusal (nothing reserved, nothing spent) when the cap cannot hold it.
    const entry = await openPaidEntry(ledger, `${model}|${units}`, {
      credits: estimate,
    });
    const before = await kie.credits();
    if (before < estimate) {
      await ledger.settle(entry, { credits: 0 });
      throw new Error(
        `${label}: balance ${before} below the ${estimate} credits it needs (short by ${Math.round((estimate - before) * 100) / 100})`,
      );
    }
    try {
      const task = await runMediaTask(kie, body, {
        onSubmitted: (id) =>
          ledger.note(`${label}: submitted task ${id} (attempt ${attempt})`),
      });
      await kie.download(task.urls[0] as string, file);
      const after = await kie.credits();
      await ledger.settle(entry, {
        credits: task.credits ?? Math.max(0, before - after),
      });
      return task;
    } catch (error) {
      // Settle what the failure cost (kie charges 0 for a failed task), then retry once.
      const after = await kie.credits().catch(() => before - estimate);
      await ledger.settle(entry, { credits: Math.max(0, before - after) });
      await ledger.note(
        `${label}: attempt ${attempt} failed: ${(error as Error).message}`,
      );
      if (attempt === 2) throw error;
    }
  }
  throw new Error("unreachable");
}

const urls = new Map<string, string>();
const upload = async (file: string, type: string) => {
  const hit = urls.get(file);
  if (hit) return hit;
  const url = await kie.upload(file, type);
  urls.set(file, url);
  return url;
};

// Bible images.
for (const job of imageJobs) {
  const file = join(out, "images", `${job.id}.png`);
  if (existsSync(file)) continue;
  const refs = await Promise.all(
    job.from.map((id) => upload(join(out, "images", `${id}.png`), "image/png")),
  );
  await generate(
    job.id,
    refs.length ? SEEDREAM_I2I : SEEDREAM_T2I,
    "1 image 2K",
    KIE_PRICES.seedreamFlashPerImage,
    seedreamBody({
      prompt: job.prompt,
      imageUrls: refs,
      aspectRatio: job.id.startsWith("set") ? "16:9" : "2:3",
    }),
    file,
  );
}
const identityBible = score("identity", [
  "--ref",
  join(out, "images", "costume-a.png"),
  "--cand",
  join(out, "images", "costume-b.png"),
  join(out, "images", "costume-c.png"),
  "--out",
  join(out, "scores", "identity-bible.json"),
]);

// Drafts, gates, finals.
const results = [];
for (const s of shots) {
  const draft = join(out, "drafts", `segment-${s.segment}-draft.mp4`);
  const task = await generate(
    `draft ${s.index}`,
    SEEDANCE,
    `${s.generateSeconds} s draft 480p + ${s.segmentSeconds} s ref video`,
    s.draftCredits,
    seedanceDraftBody({
      prompt: s.prompt,
      imageUrls: await Promise.all(
        s.images.map((i) => upload(i.file, "image/png")),
      ),
      videoUrls: [await upload(s.refVideo, "video/mp4")],
      seconds: s.generateSeconds,
    }),
    draft,
  );
  const gate = gateClip(s, draft, "draft");
  const row: Record<string, unknown> = {
    shot: s.index,
    draftTask: task.taskId,
    draft: gate,
  };
  if (gate.pass && finalsPlanned.includes(s.index)) {
    const final = join(out, "finals", `segment-${s.segment}-1080p.mp4`);
    try {
      await generate(
        `final ${s.index}`,
        SEEDANCE_UPGRADE,
        `${s.generateSeconds} s 1080p upgrade + ${s.segmentSeconds} s ref video`,
        s.finalCredits,
        seedanceUpgradeBody(task.taskId),
        final,
      );
      row.final = gateClip(s, final, "final");
    } catch (error) {
      row.final = { error: (error as Error).message };
    }
  }
  results.push(row);
}
await save("gates.json", {
  thresholds: GATE_THRESHOLDS,
  identityBible,
  drafts: results,
  calibration: calibration(),
});

// Assembly: the generated shots (final if it passed, else a passing draft) in the rung-1 previz.
const clips = cutPlan.segments.map((s) =>
  join(rung1, "clips", `segment-${String(s.index + 1).padStart(2, "0")}.mp4`),
);
const replacements = new Map<number, string>();
for (const s of shots) {
  const r = results.find((x) => x.shot === s.index) as
    | {
        draft: { pass: boolean; fit: string };
        final?: { pass?: boolean; fit?: string };
      }
    | undefined;
  const pick = r?.final?.pass
    ? r.final.fit
    : r?.draft.pass
      ? r.draft.fit
      : null;
  if (pick) replacements.set(s.index, pick);
}
const list = join(out, "assembly.txt");
const joined = withReplacements(clips, replacements);
await writeFile(list, concatList(joined));
const assembled = join(out, "assembled.mp4");
run("ffmpeg", assembleArgs(list, master, assembled, { reencode: true }));
const sync = syncCheck(cutPlan, {
  videoFrames: frames(assembled),
  videoSeconds: seconds(assembled, "v:0"),
  audioSeconds: seconds(assembled, "a:0"),
  clipFrames: joined.map(frames),
});
await save("sync.json", { replaced: [...replacements.keys()], ...sync });
console.log(`assembled: replaced ${[...replacements.keys()]} sync ${sync.ok}`);

// ---------------------------------------------------------------- gates
function score(kind: "identity" | "lipsync", args: string[]) {
  const script = join(
    pyDir,
    kind === "identity" ? "identity_score.py" : "lipsync_score.py",
  );
  run(values.python as string, [script, ...args]);
  return json(args[args.indexOf("--out") + 1] as string);
}

function gateClip(s: (typeof shots)[number], clip: string, tag: string) {
  const fit = join(out, "fit", `segment-${s.segment}-${tag}.mp4`);
  run("ffmpeg", fitClipArgs(clip, s.targetFrames, fit, fps));
  const cuts = parseSceneCuts(run("ffmpeg", sceneCutArgs(fit)));
  const lip = s.sung
    ? score("lipsync", [
        "--video",
        fit,
        "--audio",
        s.refVideo,
        "--fps",
        String(fps),
        "--out",
        join(out, "scores", `lipsync-${s.segment}-${tag}.json`),
      ])
    : null;
  const id = s.performer
    ? score("identity", [
        "--ref",
        join(out, "images", "costume-a.png"),
        "--cand",
        fit,
        "--out",
        join(out, "scores", `identity-${s.segment}-${tag}.json`),
      ])
    : null;
  const m: DraftMeasurements = {
    shot: {
      index: s.index,
      kind: s.kind,
      sung: s.sung,
      performer: s.performer,
    },
    fps,
    targetFrames: s.targetFrames,
    measuredFrames: frames(fit),
    sceneCuts: cuts.length,
    lipSync: lip?.summary
      ? {
          offsetFrames: lip.summary.offsetFrames,
          confidence: lip.summary.confidence,
        }
      : null,
    identity: id
      ? {
          faceCosine: id.candidates[0].faceCosine,
          fullCosine: id.candidates[0].fullCosine,
          facesFound: id.candidates[0].facesFound,
        }
      : null,
  };
  return { fit, cutTimes: cuts, ...evaluateDraftGates(m) };
}

// The controls the thresholds were fixed on (files written by the scorers into calibration/).
function calibration() {
  const dir = join(out, "calibration");
  const read = (f: string) =>
    existsSync(join(dir, f)) ? json(join(dir, f)) : null;
  const lip = (f: string) => {
    const r = read(f);
    return r
      ? {
          shiftMs: r.shiftMs,
          audio: r.audio,
          ...r.summary,
          tracks: r.tracks.length,
        }
      : null;
  };
  return {
    lipSync: {
      clip: "syncnet_python data/example.avi (published result: offset 3 steps, confidence 10.021)",
      asIs: lip("example-0.json"),
      audioDelayed200ms: lip("example-p200.json"),
      audioAdvanced200ms: lip("example-m200.json"),
      wrongAudio: lip("example-wrongaudio.json"),
      tutorialCloseUpWithNarration: lip("tut-closeup.json"),
    },
    identity: read("identity-tutorial.json"),
  };
}
