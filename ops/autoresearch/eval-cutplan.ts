// FROZEN evaluator of the cut planner (autoresearch run nov14-cutplan). Do not edit during the loop.
//   pnpm exec tsx ops/autoresearch/eval-cutplan.ts > run.log 2>&1 ; grep "^score:" run.log
// Runs planCuts on every song of the golden set and scores the plans with its own geometry (it
// never trusts the planner's labels). The formula is written in ops/autoresearch/program.md.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CutPlanInput,
  type CutPlanLine,
  planCuts,
  type SongSection,
} from "../../packages/shared/src/music-video/cut-plan.js";

const GOLDEN =
  process.env.GOLDEN_DIR ?? "E:/mellodifai/tmp/autoresearch/golden";
const FPS = 30;
const MIN_S = 8;
const MAX_S = 15;
// A cut this close to a downbeat gets full credit; the credit falls to 0 at DOWNBEAT_ZERO_S.
const DOWNBEAT_FULL_S = 0.05;
const DOWNBEAT_ZERO_S = 0.25;
// A silence this long inside a line also ends a phrase.
const PHRASE_PAUSE_S = 1.2;
const W_DOWNBEAT = 50;
const W_PHRASE = 50;
const W_SPREAD = 1;
const EPS = 1e-6;

type Timing = {
  duration: number;
  lines: CutPlanLine[];
  sections?: (SongSection & { tag?: string })[];
};
type Beats = { beats: number[]; downbeats: number[] };
type Word = { start: number; end: number; text: string; lineEnd: boolean };

function wordsOf(lines: CutPlanLine[], duration: number): Word[] {
  const out: Word[] = [];
  for (const line of lines) {
    const valid = (line.words ?? []).filter(
      (w) =>
        Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start,
    );
    valid.forEach((w, i) => {
      out.push({
        start: w.start,
        end: w.end,
        text: (w.w ?? w.word ?? "").trim(),
        lineEnd: i === valid.length - 1,
      });
    });
  }
  return out
    .filter((w) => w.start < duration && w.end > 0)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

const inside = (t: number, words: Word[]) =>
  words.some((w) => w.start + EPS < t && t < w.end - EPS);

function phraseEnd(t: number, words: Word[]) {
  let before: Word | undefined;
  let after: Word | undefined;
  for (const w of words) {
    if (w.end <= t + EPS) before = w;
    else if (w.start >= t - EPS && !after) after = w;
  }
  if (!before || !after) return true;
  if (before.lineEnd) return true;
  return after.start - before.end >= PHRASE_PAUSE_S;
}

function downbeatCredit(t: number, downbeats: number[]) {
  const d = Math.min(...downbeats.map((b) => Math.abs(b - t)));
  if (d <= DOWNBEAT_FULL_S) return 1;
  return Math.max(
    0,
    1 - (d - DOWNBEAT_FULL_S) / (DOWNBEAT_ZERO_S - DOWNBEAT_FULL_S),
  );
}

type SongResult = {
  song: string;
  score: number;
  // The score before the gates (information only, never the metric).
  raw: number;
  gated: boolean;
  segments: number;
  cuts: number;
  downbeat: number;
  phrase: number;
  spread: number;
  wordsCut: number;
  outOfRange: number;
  broken: string[];
};

function evaluate(song: string): SongResult {
  const timing = JSON.parse(
    readFileSync(join(GOLDEN, song, "timing.json"), "utf8"),
  ) as Timing;
  const beats = JSON.parse(
    readFileSync(join(GOLDEN, song, "beats.json"), "utf8"),
  ) as Beats;
  const input: CutPlanInput = {
    duration: timing.duration,
    lines: timing.lines,
    sections: (timing.sections ?? []).map(({ name, start, end }) => ({
      name,
      start,
      end,
    })),
    downbeats: beats.downbeats,
    beats: beats.beats,
  };
  const words = wordsOf(timing.lines, timing.duration);
  const broken: string[] = [];
  const fail = (reason: string): SongResult => ({
    song,
    score: 0,
    raw: 0,
    gated: true,
    segments: 0,
    cuts: 0,
    downbeat: 0,
    phrase: 0,
    spread: 0,
    wordsCut: 0,
    outOfRange: 0,
    broken: [reason],
  });
  let segs: ReturnType<typeof planCuts>["segments"];
  try {
    segs = planCuts(input, { fps: FPS }).segments;
  } catch (e) {
    return fail(`planner threw: ${(e as Error).message}`);
  }
  if (!segs.length) return fail("no segments");
  // Coverage: 0..duration, contiguous in seconds and in frames, every word in one segment.
  const frames = Math.round(timing.duration * FPS);
  if (Math.abs((segs[0]?.start ?? 1) - 0) > EPS || segs[0]?.startFrame !== 0)
    broken.push("does not start at 0");
  if (
    Math.abs((segs.at(-1)?.end ?? 0) - timing.duration) > EPS ||
    segs.at(-1)?.endFrame !== frames
  )
    broken.push("does not end at the song end");
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1];
    const b = segs[i];
    if (!a || !b) continue;
    if (Math.abs(b.start - a.end) > EPS || b.startFrame !== a.endFrame)
      broken.push(`segment ${i} not contiguous`);
    if (b.startFrame !== Math.round(b.start * FPS))
      broken.push(`segment ${i} frame does not match its time`);
  }
  for (const w of words) {
    const owners = segs.filter(
      (s) => w.start >= s.start - EPS && w.end <= s.end + EPS,
    ).length;
    if (owners !== 1) {
      broken.push(`word "${w.text}" at ${w.start} in ${owners} segments`);
      break;
    }
  }
  // Cuts: the time in seconds (audio wrappers) and the frame time (picture) both count.
  const cuts = segs
    .slice(1)
    .map((s) => ({ t: s.start, f: s.startFrame / FPS }));
  const wordsCut = cuts.filter(
    (c) => inside(c.t, words) || inside(c.f, words),
  ).length;
  const lengths = segs.map((s) => s.end - s.start);
  const frameLengths = segs.map((s) => (s.endFrame - s.startFrame) / FPS);
  const outOfRange = segs.filter(
    (_, i) =>
      (lengths[i] as number) < MIN_S - EPS ||
      (lengths[i] as number) > MAX_S + EPS ||
      (frameLengths[i] as number) < MIN_S - 1 / FPS ||
      (frameLengths[i] as number) > MAX_S + 1 / FPS,
  ).length;
  const downbeat = cuts.length
    ? cuts.reduce((sum, c) => sum + downbeatCredit(c.f, beats.downbeats), 0) /
      cuts.length
    : 1;
  const phrase = cuts.length
    ? cuts.filter((c) => phraseEnd(c.t, words)).length / cuts.length
    : 1;
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const spread = Math.sqrt(
    lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length,
  );
  const gated = wordsCut > 0 || outOfRange > 0 || broken.length > 0;
  const raw = W_DOWNBEAT * downbeat + W_PHRASE * phrase - W_SPREAD * spread;
  return {
    song,
    score: gated ? 0 : raw,
    raw,
    gated,
    segments: segs.length,
    cuts: cuts.length,
    downbeat,
    phrase,
    spread,
    wordsCut,
    outOfRange,
    broken,
  };
}

const songs = readdirSync(GOLDEN, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const hash = createHash("sha256");
for (const s of songs)
  for (const f of ["timing.json", "beats.json"])
    hash.update(readFileSync(join(GOLDEN, s, f)));
const started = Date.now();
const results = songs.map(evaluate);
const avg = (k: "score" | "raw" | "downbeat" | "phrase" | "spread") =>
  results.reduce((a, r) => a + r[k], 0) / results.length;
for (const r of results)
  console.log(
    `song ${r.song}: score=${r.score.toFixed(3)} segments=${r.segments} downbeat=${r.downbeat.toFixed(3)} phrase=${r.phrase.toFixed(3)} spread=${r.spread.toFixed(3)} words_cut=${r.wordsCut} out_of_range=${r.outOfRange}${r.broken.length ? ` broken=${r.broken.join("; ")}` : ""}`,
  );
console.log(
  `golden: ${songs.length} songs sha256=${hash.digest("hex").slice(0, 16)}`,
);
console.log(`downbeat_share: ${avg("downbeat").toFixed(4)}`);
console.log(`phrase_share: ${avg("phrase").toFixed(4)}`);
console.log(`spread_s: ${avg("spread").toFixed(4)}`);
console.log(`words_cut: ${results.reduce((a, r) => a + r.wordsCut, 0)}`);
console.log(`out_of_range: ${results.reduce((a, r) => a + r.outOfRange, 0)}`);
console.log(`gated_songs: ${results.filter((r) => r.gated).length}`);
console.log(`raw_score_ungated: ${avg("raw").toFixed(4)}`);
console.log(`seconds: ${((Date.now() - started) / 1000).toFixed(1)}`);
console.log(`score: ${avg("score").toFixed(4)}`);
