// Rung 1 proof, without the database: one real song through the free music-video stages.
//   tsx scripts/music-video-previz.ts --timing timing.json --master master.wav --style "..."
//     --out <folder> [--work <folder>] [--only 3]
// Writes cutplan.json, shotlist.json, audio/segment-NN-audio.mp4 (black picture + segment audio),
// clips/segment-NN.mp4 (previz, Remotion), previz.mp4 (all clips + the master), sync.json and
// contact-sheet-N.jpg into --out.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  assembleArgs,
  concatList,
  genreOf,
  previzProps,
  type SongTiming,
  syncCheck,
  writeMusicVideoPlan,
} from "../src/stages/music-video.js";

const { values } = parseArgs({
  options: {
    timing: { type: "string" },
    master: { type: "string" },
    style: { type: "string", default: "pop" },
    out: { type: "string" },
    work: { type: "string" },
    only: { type: "string" },
    // Keep clips already rendered (re-run only the assembly and checks).
    reuse: { type: "boolean", default: false },
  },
});
if (!values.timing || !values.master || !values.out) {
  console.error("usage: --timing <timing.json> --master <wav> --out <folder>");
  process.exit(1);
}
const out = resolve(values.out);
const work = resolve(values.work ?? join(out, "work"));
const visualizer = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/visualizer",
);
const renderTmp = process.env.RENDER_TMP || join(work, "render-tmp");
const shell =
  process.env.REMOTION_BROWSER ||
  "C:\\Users\\Asus\\Documents\\suno-remake\\motion\\node_modules\\.remotion\\chrome-headless-shell\\win64\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
for (const dir of [out, work, renderTmp, join(out, "clips")])
  mkdirSync(dir, { recursive: true });

function run(command: string, args: string[], cwd?: string): string {
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TEMP: renderTmp, TMP: renderTmp },
  });
  if (r.status !== 0)
    throw new Error(
      `${command} failed (${r.status}): ${(r.stderr || r.stdout || "").slice(-2000)}`,
    );
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

function probe(file: string, stream: string, entries: string): string[] {
  return run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    stream,
    "-count_packets",
    "-show_entries",
    entries,
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ])
    .trim()
    .split(/\r?\n/u);
}

const t0 = Date.now();
const timing = JSON.parse(readFileSync(values.timing, "utf8")) as SongTiming;
const plan = await writeMusicVideoPlan(timing, {
  genre: genreOf(values.style ?? "pop"),
  master: resolve(values.master),
  dir: out,
  run: async (command, args) => run(command, args),
});
console.log(
  `plan: ${JSON.stringify(plan.check)} wrappers=${plan.wrappers.length} (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
);

// One bundle of the visualizer package, then one Remotion render per shot.
const cli = join(
  visualizer,
  "node_modules",
  "@remotion",
  "cli",
  "remotion-cli.js",
);
const bundle = join(work, "bundle");
if (!existsSync(join(bundle, "index.html")))
  run(
    process.execPath,
    [cli, "bundle", "src/index.ts", `--out-dir=${bundle}`, "--log=error"],
    visualizer,
  );
const only = values.only === undefined ? null : Number(values.only);
const clips: string[] = [];
for (const shot of plan.shotList.shots) {
  const name = `segment-${String(shot.segment + 1).padStart(2, "0")}`;
  const clip = join(out, "clips", `${name}.mp4`);
  clips.push(clip);
  if (only !== null && shot.index !== only) continue;
  if (values.reuse && existsSync(clip)) continue;
  const props = join(work, `${name}.props.json`);
  writeFileSync(props, JSON.stringify(previzProps(shot, timing)));
  const started = Date.now();
  run(
    process.execPath,
    [
      cli,
      "render",
      bundle,
      "Previz",
      clip,
      `--props=${props}`,
      "--codec=h264",
      "--crf=20",
      "--pixel-format=yuv420p",
      "--muted",
      "--gl=angle",
      "--concurrency=8",
      "--log=error",
      ...(existsSync(shell) ? [`--browser-executable=${shell}`] : []),
    ],
    visualizer,
  );
  console.log(
    `${name}: ${shot.kind} ${shot.camera} ${shot.endFrame - shot.startFrame} frames (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
}
if (only !== null) process.exit(0);

// Assembly: the clips joined as they are, the master as the sound.
const list = join(work, "clips.txt");
writeFileSync(list, concatList(clips));
const previz = join(out, "previz.mp4");
run("ffmpeg", assembleArgs(list, resolve(values.master), previz));
const clipFrames = clips.map((c) =>
  Number(probe(c, "v:0", "stream=nb_read_packets")[0]),
);
// ffprobe prints fields in its own order, so one field per call.
const videoFrames = Number(probe(previz, "v:0", "stream=nb_read_packets")[0]);
const videoSeconds = Number(probe(previz, "v:0", "stream=duration")[0]);
const [audioSeconds] = probe(previz, "a:0", "stream=duration").map(Number);
const sync = syncCheck(plan.cutPlan, {
  videoFrames: videoFrames ?? 0,
  videoSeconds: videoSeconds ?? 0,
  audioSeconds: audioSeconds ?? 0,
  clipFrames,
});
// An outside look at the boundaries: where ffmpeg sees a picture change in the final file.
const scenes = run("ffmpeg", [
  "-hide_banner",
  "-i",
  previz,
  "-an",
  "-vf",
  "select='gt(scene,0.2)',showinfo",
  "-f",
  "null",
  "-",
])
  .split(/\r?\n/u)
  .flatMap((line) => {
    const m = /showinfo.*\bn:\s*\d+.*\bpts_time:([\d.]+)/u.exec(line);
    return m?.[1] ? [Math.round(Number(m[1]) * plan.cutPlan.fps)] : [];
  });
const planned = plan.cutPlan.segments.slice(1).map((s) => s.startFrame);
const detected = planned.filter((f) => scenes.includes(f)).length;
writeFileSync(
  join(out, "sync.json"),
  `${JSON.stringify({ ...sync, sceneCuts: { planned: planned.length, detectedOnPlannedFrame: detected, detectedFrames: scenes } }, null, 2)}\n`,
);
console.log(
  `sync: ok=${sync.ok} videoFrames=${sync.videoFrames}/${sync.plannedFrames} video=${sync.videoSeconds}s audio=${sync.audioSeconds}s drift=${sync.driftFrames} frames; scene cuts on planned frames ${detected}/${planned.length} ${sync.reasons.join("; ")}`,
);

// Six contact sheets, each nine frames from one sixth of the video.
const total = videoSeconds ?? 0;
for (let k = 0; k < 6; k++) {
  const from = (total / 6) * k;
  const every = total / 6 / 9;
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    from.toFixed(3),
    "-t",
    (total / 6).toFixed(3),
    "-i",
    previz,
    "-vf",
    `fps=1/${every.toFixed(4)},scale=426:-2,tile=3x3:padding=4:color=black`,
    "-frames:v",
    "1",
    join(out, `contact-sheet-${k + 1}.jpg`),
  ]);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
