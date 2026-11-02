// Deterministic parts of the blueprint: shot timing from the source's scene cuts, snapped
// to beats and split at section starts (the vision model only describes the look), the
// frame cap of R1, contact-sheet addressing and the vocal type from stem measurements.
import type { BLUEPRINT_VOCALS, RemakeSection } from "@mellodifai/shared";

export type ShotSkeleton = {
  id: string;
  start: number;
  end: number;
  sectionId: string;
  offsetInSection: number;
  onBeat: boolean;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function nearest(times: number[], t: number): number | undefined {
  let best: number | undefined;
  for (const x of times)
    if (best === undefined || Math.abs(x - t) < Math.abs(best - t)) best = x;
  return best;
}

export function buildShots(input: {
  cuts: number[];
  beats: number[];
  sections: RemakeSection[];
  durationS: number;
  maxShots?: number;
  snap?: number;
}): ShotSkeleton[] {
  const snapWithin = input.snap ?? 0.25;
  const onBeatWithin = 0.08;
  const duration = input.durationS;
  const snapped = input.cuts.map((t) => {
    const b = nearest(input.beats, t);
    return b !== undefined && Math.abs(b - t) <= snapWithin ? b : t;
  });
  const edges = [0, ...snapped, ...input.sections.map((s) => s.start)]
    .filter((t) => t >= 0 && t < duration)
    .sort((a, b) => a - b)
    .reduce<number[]>((acc, t) => {
      if (acc.length === 0 || t - (acc.at(-1) ?? 0) >= 0.4) acc.push(r3(t));
      return acc;
    }, []);
  let spans = edges.map((start, i) => ({
    start,
    end: edges[i + 1] ?? r3(duration),
  }));
  // Flicker: a span under 0.4 s joins its neighbour (the tail joins the previous one).
  const last = spans.at(-1);
  if (spans.length > 1 && last && last.end - last.start < 0.4) {
    spans.pop();
    const prev = spans.at(-1);
    if (prev) prev.end = last.end;
  }
  const maxShots = input.maxShots ?? 200;
  // Over the cap, the shortest shot merges into its shorter neighbour.
  while (spans.length > maxShots) {
    let k = 0;
    for (let i = 1; i < spans.length; i++) {
      const s = spans[i];
      const best = spans[k];
      if (s && best && s.end - s.start < best.end - best.start) k = i;
    }
    const left = spans[k - 1];
    const right = spans[k + 1];
    const target =
      !right || (left && left.end - left.start <= right.end - right.start)
        ? k - 1
        : k + 1;
    const a = Math.min(k, target);
    const merged = {
      start: spans[a]?.start ?? 0,
      end: spans[a + 1]?.end ?? duration,
    };
    spans = [...spans.slice(0, a), merged, ...spans.slice(a + 2)];
  }
  const isBeat = (t: number) =>
    t <= 0 ||
    t >= duration ||
    input.beats.some((b) => Math.abs(b - t) <= onBeatWithin);
  return spans.map((span, i) => {
    const mid = (span.start + span.end) / 2;
    const section =
      input.sections.find((s) => mid >= s.start && mid < s.end) ??
      input.sections.at(-1);
    const length = section ? section.end - section.start : 1;
    return {
      id: `shot-${String(i + 1).padStart(3, "0")}`,
      start: span.start,
      end: span.end,
      sectionId: section?.id ?? "",
      offsetInSection: section
        ? Math.min(1, Math.max(0, r3((span.start - section.start) / length)))
        : 0,
      onBeat: isBeat(span.start) && isBeat(span.end),
    };
  });
}

// R1 keeps at most `n` frames: drop the cut closest to its neighbours until it fits.
export function capFrames(cuts: number[], n: number): number[] {
  const kept = [...cuts].sort((a, b) => a - b);
  while (kept.length > n) {
    let k = 1;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < kept.length; i++) {
      const gap =
        (kept[i] ?? 0) -
        (kept[i - 1] ?? 0) +
        ((kept[i + 1] ?? Number.POSITIVE_INFINITY) - (kept[i] ?? 0));
      if (gap < bestGap) {
        bestGap = gap;
        k = i;
      }
    }
    kept.splice(k, 1);
  }
  return kept;
}

export const SHEET = { cols: 5, rows: 4 };
const PER_SHEET = SHEET.cols * SHEET.rows;

// Contact sheets hold one frame per second, 20 per sheet; sheets and cells count from 1.
export function sheetCells(start: number, end: number): string {
  const a = Math.floor(start);
  const b = Math.max(a, Math.ceil(end) - 1);
  const sa = Math.floor(a / PER_SHEET) + 1;
  const sb = Math.floor(b / PER_SHEET) + 1;
  const ca = (a % PER_SHEET) + 1;
  const cb = (b % PER_SHEET) + 1;
  return sa === sb
    ? `sheet ${sa} cells ${ca}-${cb}`
    : `sheet ${sa} cell ${ca} to sheet ${sb} cell ${cb}`;
}

export type VocalMeasure = {
  medianF0Hz: number | null;
  voicedShare: number | null;
  pitchStability: number | null;
  lowShare?: number | null;
  highShare?: number | null;
} | null;

export function classifyVocal(
  vocal: VocalMeasure,
  stemShares: { vocals: number } | null,
  hasLines: boolean,
): {
  type: (typeof BLUEPRINT_VOCALS)[number] | null;
  delivery: "sung" | "rap" | "unknown";
} {
  if (!hasLines && (!stemShares || stemShares.vocals < 0.03))
    return { type: "none", delivery: "unknown" };
  if (!vocal || vocal.medianF0Hz === null)
    return { type: null, delivery: "unknown" };
  const rap =
    (vocal.pitchStability ?? 1) < 0.35 && (vocal.voicedShare ?? 1) < 0.55;
  const delivery = rap ? "rap" : "sung";
  if ((vocal.lowShare ?? 0) >= 0.25 && (vocal.highShare ?? 0) >= 0.25)
    return { type: "duet", delivery };
  if (vocal.medianF0Hz < 165) return { type: "male", delivery };
  if (vocal.medianF0Hz > 200) return { type: "female", delivery };
  return { type: null, delivery };
}
