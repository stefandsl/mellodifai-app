// The cut plan of a music video: the song cut into 8-15 s segments, each cut on a downbeat at
// or near a phrase end and never inside a word, covering the whole song with no gap or overlap.
// A video model (Seedance) takes at most 30 s and makes fewer mistakes on 10-15 s, so this is
// the unit every later stage (shot list, previz, lip-sync generation, assembly) works on.
import { z } from "zod";

export type TimedWord = {
  w?: string;
  word?: string;
  start: number;
  end: number;
};
export type TimedLine = { section?: string; text?: string; words: TimedWord[] };
export type SongSection = { name: string; start: number; end: number };

export type CutPlanInput = {
  // Song length in seconds.
  duration: number;
  lines: TimedLine[];
  sections?: SongSection[];
  // Downbeat (bar start) and beat times in seconds, from a beat tracker (beat-this).
  downbeats: number[];
  beats?: number[];
};

export type CutPlanOptions = {
  fps?: number;
  // Never above this length (Seedance's limit).
  maxSeconds?: number;
};

export const CUT_KINDS = ["edge", "downbeat", "beat", "gap"] as const;
export type CutKind = (typeof CUT_KINDS)[number];

export const MIN_SEGMENT_S = 8;
export const TARGET_MIN_S = 10;
export const TARGET_MAX_S = 15;
export const MAX_SEGMENT_S = 30;
// A downbeat this close to a word edge still counts as "on the downbeat" once the cut moves to
// the gap next to that word.
export const DOWNBEAT_SNAP_S = 0.35;
// A pause this long inside a line also ends a phrase.
const PHRASE_PAUSE_S = 1.2;

export const CutSchema = z.object({
  at: z.number().min(0),
  kind: z.enum(CUT_KINDS),
  phraseEnd: z.boolean(),
  // Distance from the cut to the downbeat it stands for (0 when exactly on it).
  snap: z.number().min(0),
});
export type Cut = z.infer<typeof CutSchema>;

export const SegmentSchema = z.object({
  index: z.number().int().min(0),
  start: z.number().min(0),
  end: z.number().positive(),
  duration: z.number().positive(),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().positive(),
  section: z.string(),
  sung: z.boolean(),
  // The exact lyrics sung in the segment, one line per lyric line (empty when instrumental).
  text: z.string(),
  wordCount: z.number().int().min(0),
  // Seconds of the segment with a word sounding.
  sungSeconds: z.number().min(0),
  cutIn: CutSchema,
  cutOut: CutSchema,
});
export type Segment = z.infer<typeof SegmentSchema>;

export const CutPlanSchema = z.object({
  version: z.literal(1),
  duration: z.number().positive(),
  fps: z.number().int().positive(),
  frames: z.number().int().positive(),
  segments: z.array(SegmentSchema).min(1),
});
export type CutPlan = z.infer<typeof CutPlanSchema>;

type Word = {
  text: string;
  start: number;
  end: number;
  line: number;
  lineEnd: boolean;
};

type Candidate = Cut & { cost: number };

const EPS = 1e-6;

function flatWords(lines: TimedLine[]): Word[] {
  const words: Word[] = [];
  lines.forEach((line, lineIndex) => {
    const valid = (line.words ?? []).filter(
      (w) =>
        Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start,
    );
    valid.forEach((w, i) => {
      words.push({
        text: (w.w ?? w.word ?? "").trim(),
        start: w.start,
        end: w.end,
        line: lineIndex,
        lineEnd: i === valid.length - 1,
      });
    });
  });
  return words.sort((a, b) => a.start - b.start || a.end - b.end);
}

// True when `t` falls strictly inside a word.
export function insideWord(t: number, words: { start: number; end: number }[]) {
  return words.some((w) => w.start + EPS < t && t < w.end - EPS);
}

function lastIndexBefore(words: Word[], t: number) {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((words[mid] as Word).end <= t + EPS) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function firstIndexFrom(words: Word[], t: number) {
  let lo = 0;
  let hi = words.length - 1;
  let found = words.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((words[mid] as Word).start >= t - EPS) {
      found = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return found;
}

// A cut ends a phrase when the word before it ends a lyric line (or a pause), or no word is near.
function endsPhrase(words: Word[], t: number) {
  const before = words[lastIndexBefore(words, t)];
  const after = words[firstIndexFrom(words, t)];
  if (!before || !after) return true;
  if (before.lineEnd || before.line !== after.line) return true;
  return after.start - before.end >= PHRASE_PAUSE_S;
}

// Where a cut may go: downbeats (snapped to the gap next to the word they fall in), beats, and
// as a last resort any gap between words. Lower cost is better.
function candidates(input: CutPlanInput, words: Word[]): Candidate[] {
  const out: Candidate[] = [];
  const inRange = (t: number) => t > 0.5 && t < input.duration - 0.5;
  const sectionStarts = (input.sections ?? []).map((s) => s.start);
  const nearSection = (t: number) =>
    sectionStarts.some((s) => Math.abs(s - t) <= 1.0);
  const add = (at: number, kind: CutKind, snap: number, base: number) => {
    if (!inRange(at) || insideWord(at, words)) return;
    const phraseEnd = endsPhrase(words, at);
    let cost = base + snap * 10;
    if (!phraseEnd) cost += kind === "gap" ? 30 : 25;
    if (nearSection(at)) cost -= 6;
    out.push({ at, kind, phraseEnd, snap, cost });
  };
  for (const d of input.downbeats) {
    if (!insideWord(d, words)) {
      add(d, "downbeat", 0, 0);
      continue;
    }
    const host = words.find((w) => w.start + EPS < d && d < w.end - EPS);
    if (!host) continue;
    const i = words.indexOf(host);
    // The singer lands the word on the bar: cut in the gap just before it.
    if (d - host.start <= DOWNBEAT_SNAP_S) {
      const prevEnd = words[i - 1]?.end ?? 0;
      const at = Math.max(prevEnd, host.start - 0.04);
      add(at, "downbeat", Math.abs(d - at), 2);
    }
    // The word ends just after the bar line: cut in the gap after it.
    if (host.end - d <= DOWNBEAT_SNAP_S) {
      const nextStart = words[i + 1]?.start ?? input.duration;
      const at = Math.min(nextStart, host.end + 0.04);
      add(at, "downbeat", Math.abs(at - d), 2);
    }
  }
  const downbeats = new Set(input.downbeats.map((d) => d.toFixed(3)));
  for (const b of input.beats ?? [])
    if (!downbeats.has(b.toFixed(3))) add(b, "beat", 0, 12);
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1] as Word;
    const b = words[i] as Word;
    if (b.start - a.end > EPS) add((a.end + b.start) / 2, "gap", 0, 60);
  }
  // One candidate per 50 ms, the cheapest.
  out.sort((a, b) => a.at - b.at || a.cost - b.cost);
  const kept: Candidate[] = [];
  for (const c of out) {
    const last = kept.at(-1);
    if (last && c.at - last.at < 0.05) {
      if (c.cost < last.cost) kept[kept.length - 1] = c;
    } else kept.push(c);
  }
  return kept;
}

function lengthCost(len: number, max: number) {
  if (len > max + EPS) return Number.POSITIVE_INFINITY;
  if (len < 4) return 400 + (4 - len) * 50;
  if (len < MIN_SEGMENT_S) return 120 + (MIN_SEGMENT_S - len) * 25;
  if (len < TARGET_MIN_S) return (TARGET_MIN_S - len) * 4;
  if (len <= TARGET_MAX_S) return Math.abs(len - 12.5) * 0.4;
  return 60 + (len - TARGET_MAX_S) * 12;
}

function sungSpan(words: Word[], start: number, end: number) {
  const from = firstIndexFrom(words, start);
  const to = lastIndexBefore(words, end);
  if (from > to) return null;
  return {
    from,
    to,
    first: (words[from] as Word).start,
    last: (words[to] as Word).end,
  };
}

// A segment that mixes a long instrumental stretch with singing should be two segments.
function mixCost(words: Word[], start: number, end: number) {
  const span = sungSpan(words, start, end);
  if (!span) return 0;
  const lead = span.first - start;
  const tail = end - span.last;
  return Math.max(0, lead - 4) * 3 + Math.max(0, tail - 4) * 3;
}

function sectionAt(
  input: CutPlanInput,
  words: Word[],
  start: number,
  end: number,
) {
  const span = sungSpan(words, start, end);
  const mid = span ? (span.first + span.last) / 2 : (start + end) / 2;
  const sections = input.sections ?? [];
  const hit =
    sections.find((s) => s.start <= mid && mid < s.end) ??
    [...sections].reverse().find((s) => s.start <= mid) ??
    sections[0];
  if (hit) return hit.name;
  return span
    ? (input.lines[(words[span.from] as Word).line]?.section ?? "")
    : "";
}

function segmentText(words: Word[], from: number, to: number) {
  const lines: string[] = [];
  let current = -1;
  for (let i = from; i <= to; i++) {
    const w = words[i] as Word;
    if (w.line !== current) {
      lines.push(w.text);
      current = w.line;
    } else lines[lines.length - 1] += ` ${w.text}`;
  }
  return lines.map((l) => l.trim()).join("\n");
}

export function planCuts(
  input: CutPlanInput,
  options: CutPlanOptions = {},
): CutPlan {
  const fps = options.fps ?? 30;
  const max = Math.min(options.maxSeconds ?? MAX_SEGMENT_S, MAX_SEGMENT_S);
  const duration = input.duration;
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("Song duration is required for the cut plan");
  const words = flatWords(input.lines).filter(
    (w) => w.start < duration && w.end > 0,
  );
  const edge = (at: number): Candidate => ({
    at,
    kind: "edge",
    phraseEnd: true,
    snap: 0,
    cost: 0,
  });
  const nodes = [edge(0), ...candidates(input, words), edge(duration)];
  const best = new Array<number>(nodes.length).fill(Number.POSITIVE_INFINITY);
  const from = new Array<number>(nodes.length).fill(-1);
  best[0] = 0;
  for (let j = 1; j < nodes.length; j++) {
    const end = nodes[j] as Candidate;
    for (let i = j - 1; i >= 0; i--) {
      const start = nodes[i] as Candidate;
      const len = end.at - start.at;
      if (len > max + EPS) break;
      if (!Number.isFinite(best[i] as number)) continue;
      const cost =
        (best[i] as number) +
        lengthCost(len, max) +
        end.cost +
        mixCost(words, start.at, end.at);
      if (cost < (best[j] as number)) {
        best[j] = cost;
        from[j] = i;
      }
    }
  }
  const last = nodes.length - 1;
  if (!Number.isFinite(best[last] as number))
    throw new Error(
      `No cut plan keeps every segment at or under ${max} s without cutting a word`,
    );
  const path: number[] = [];
  for (let j = last; j >= 0; j = from[j] as number) {
    path.unshift(j);
    if (j === 0) break;
  }
  const strip = ({ cost: _cost, ...cut }: Candidate): Cut => cut;
  const frames = Math.round(duration * fps);
  const segments: Segment[] = [];
  for (let k = 1; k < path.length; k++) {
    const a = nodes[path[k - 1] as number] as Candidate;
    const b = nodes[path[k] as number] as Candidate;
    const span = sungSpan(words, a.at, b.at);
    const sungSeconds = span
      ? words
          .slice(span.from, span.to + 1)
          .reduce((sum, w) => sum + (w.end - w.start), 0)
      : 0;
    segments.push({
      index: k - 1,
      start: a.at,
      end: b.at,
      duration: b.at - a.at,
      startFrame: Math.round(a.at * fps),
      endFrame: k === path.length - 1 ? frames : Math.round(b.at * fps),
      section: sectionAt(input, words, a.at, b.at),
      sung: Boolean(span),
      text: span ? segmentText(words, span.from, span.to) : "",
      wordCount: span ? span.to - span.from + 1 : 0,
      sungSeconds: Math.round(sungSeconds * 1000) / 1000,
      cutIn: strip(a),
      cutOut: strip(b),
    });
  }
  return CutPlanSchema.parse({ version: 1, duration, fps, frames, segments });
}

export type CutPlanCheck = {
  ok: boolean;
  segments: number;
  minS: number;
  maxS: number;
  meanS: number;
  // Cut points that fall inside a word (must be 0).
  wordsCut: number;
  // Words that belong to no segment or to two (must be 0).
  wordsLost: number;
  gaps: number;
  overlaps: number;
  overMax: number;
  underMin: number;
  onDownbeat: number;
  atPhraseEnd: number;
  sung: number;
  instrumental: number;
  reasons: string[];
};

// Re-checks a plan against its input; tests and the report read this, not the planner's word.
export function checkCutPlan(plan: CutPlan, input: CutPlanInput): CutPlanCheck {
  const words = flatWords(input.lines).filter(
    (w) => w.start < plan.duration && w.end > 0,
  );
  const segs = plan.segments;
  const lengths = segs.map((s) => s.end - s.start);
  const reasons: string[] = [];
  let gaps = 0;
  let overlaps = 0;
  if (Math.abs((segs[0]?.start ?? 1) - 0) > EPS) gaps++;
  if (Math.abs((segs.at(-1)?.end ?? 0) - plan.duration) > EPS) gaps++;
  for (let i = 1; i < segs.length; i++) {
    const d = (segs[i] as Segment).start - (segs[i - 1] as Segment).end;
    if (d > EPS) gaps++;
    if (d < -EPS) overlaps++;
    if ((segs[i] as Segment).startFrame !== (segs[i - 1] as Segment).endFrame)
      reasons.push(
        `segment ${i} does not start on the frame where ${i - 1} ends`,
      );
  }
  if (segs.at(-1)?.endFrame !== plan.frames)
    reasons.push("last segment does not end on the last frame");
  const cuts = segs.slice(1).map((s) => s.start);
  const wordsCut = cuts.filter((t) => insideWord(t, words)).length;
  let wordsLost = 0;
  for (const w of words) {
    const owners = segs.filter(
      (s) => w.start >= s.start - EPS && w.end <= s.end + EPS,
    ).length;
    if (owners !== 1) wordsLost++;
  }
  const max = Math.max(...lengths);
  const min = Math.min(...lengths);
  const overMax = lengths.filter((l) => l > MAX_SEGMENT_S + EPS).length;
  const underMin = lengths.filter((l) => l < MIN_SEGMENT_S - EPS).length;
  if (gaps) reasons.push(`${gaps} gap(s) in coverage`);
  if (overlaps) reasons.push(`${overlaps} overlap(s)`);
  if (wordsCut) reasons.push(`${wordsCut} cut(s) inside a word`);
  if (wordsLost)
    reasons.push(`${wordsLost} word(s) not in exactly one segment`);
  if (overMax) reasons.push(`${overMax} segment(s) over ${MAX_SEGMENT_S} s`);
  for (const s of segs) {
    const expected = words
      .filter((w) => w.start >= s.start - EPS && w.end <= s.end + EPS)
      .map((w) => w.text)
      .join(" ");
    if (s.text.replace(/\s+/gu, " ").trim() !== expected.trim())
      reasons.push(`segment ${s.index} lyrics do not match its words`);
    if (s.sung !== expected.length > 0)
      reasons.push(`segment ${s.index} sung flag is wrong`);
  }
  return {
    ok: reasons.length === 0,
    segments: segs.length,
    minS: Math.round(min * 1000) / 1000,
    maxS: Math.round(max * 1000) / 1000,
    meanS:
      Math.round((lengths.reduce((a, b) => a + b, 0) / segs.length) * 1000) /
      1000,
    wordsCut,
    wordsLost,
    gaps,
    overlaps,
    overMax,
    underMin,
    onDownbeat: cuts.filter((_, i) => segs[i + 1]?.cutIn.kind === "downbeat")
      .length,
    atPhraseEnd: segs.slice(1).filter((s) => s.cutIn.phraseEnd).length,
    sung: segs.filter((s) => s.sung).length,
    instrumental: segs.filter((s) => !s.sung).length,
    reasons,
  };
}
