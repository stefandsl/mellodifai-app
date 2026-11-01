// Timed lyric lines (from captions or Whisper words) and song sections (from audio
// boundaries, beats and lyric repetition), aligned so no section boundary cuts a line.
import { charTrigramDice } from "./originality.js";
import type {
  AnalysedLine,
  Section,
  SectionKind,
  TimedLine,
} from "./schemas.js";
import { countSyllables, lineEnding } from "./syllables.js";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function cleanCaption(text: string): string {
  return (
    text
      .replace(/<[^>]*>/gu, "")
      .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gu, (e) => ENTITIES[e] ?? e)
      .replace(/\[[^\]]*\]|\((?:music|instrumental|applause|laughs?)\)/giu, "")
      .replace(/[♪♫♬]/gu, "")
      // Lyric captions stretch sung vowels ("Leeeeave", "DOOOOON'T"): one letter is enough.
      .replace(/(\p{L})\1{2,}/gu, "$1")
      .replace(/\s*[—–]\s*/gu, " - ")
      .replace(/^\s*(?:>>|-)\s*/u, "")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

function vttTime(value: string): number {
  const parts = value.trim().split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();

// Handles manual captions and YouTube auto captions, whose cues repeat the previous
// line for context and add 10 ms filler cues.
export function parseVtt(vtt: string): TimedLine[] {
  const out: TimedLine[] = [];
  for (const block of vtt.replace(/\r/gu, "").split(/\n\n+/u)) {
    const rows = block.split("\n");
    const at = rows.findIndex((r) => r.includes("-->"));
    if (at < 0) continue;
    const [from, rest] = rows[at]?.split("-->") ?? [];
    if (!from || !rest) continue;
    const start = vttTime(from);
    const end = vttTime(rest.trim().split(/\s+/u)[0] ?? "0");
    if (end - start < 0.05) continue;
    const texts = rows
      .slice(at + 1)
      .map(cleanCaption)
      .filter(Boolean);
    const recent = out.slice(-3).map((l) => norm(l.text));
    const fresh = texts.filter((t) => !recent.includes(norm(t)));
    const last = texts.at(-1);
    if (fresh.length > 0) out.push({ start, end, text: fresh.join(" ") });
    else if (last && norm(last) === norm(out.at(-1)?.text ?? "")) {
      const previous = out.at(-1);
      if (previous) previous.end = Math.max(previous.end, end);
    }
  }
  return out.map((l) => ({
    start: round(l.start),
    end: round(l.end),
    text: l.text,
  }));
}

export type TimedWord = { word: string; start: number; end: number };

export function wordsToLines(
  words: TimedWord[],
  { gap = 0.6, maxWords = 10 } = {},
): TimedLine[] {
  const lines: TimedLine[] = [];
  let current: TimedWord[] = [];
  const close = () => {
    const first = current[0];
    const last = current.at(-1);
    if (first && last)
      lines.push({
        start: round(first.start),
        end: round(last.end),
        text: current.map((w) => w.word.trim()).join(" "),
      });
    current = [];
  };
  for (const word of words) {
    const previous = current.at(-1);
    if (previous && word.start - previous.end >= gap) close();
    current.push(word);
    const text = word.word.trim();
    if (
      (/[.!?;]$/u.test(text) && current.length >= 2) ||
      (/,$/u.test(text) && current.length >= 5) ||
      current.length >= maxWords
    )
      close();
  }
  close();
  return lines;
}

// Lines sung again at least 4 s later (the chorus and hook material).
export function findRepeatedLines(lines: TimedLine[]): Set<number> {
  const repeated = new Set<number>();
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      if (
        a &&
        b &&
        Math.abs(b.start - a.start) >= 4 &&
        charTrigramDice(a.text, b.text) >= 0.75
      ) {
        repeated.add(i);
        repeated.add(j);
      }
    }
  return repeated;
}

type Segment = {
  start: number;
  end: number;
  lines: number[];
  audioLabel: string;
  kind?: SectionKind;
};

function nearest(times: number[], t: number): number | undefined {
  let best: number | undefined;
  for (const x of times)
    if (best === undefined || Math.abs(x - t) < Math.abs(best - t)) best = x;
  return best;
}

export function buildSections(input: {
  durationS: number;
  // Section boundaries found in the audio (novelty peaks), any order.
  boundaries: number[];
  // Audio similarity cluster per audio segment (boundaries.length + 1 entries).
  labels: string[];
  lines: TimedLine[];
  downbeats: number[];
  energy: { t: number; v: number }[];
}): Section[] {
  const duration = input.durationS;
  const lines = [...input.lines].sort((a, b) => a.start - b.start);
  const audioEdges = [...input.boundaries]
    .filter((b) => b > 0 && b < duration)
    .sort((a, b) => a - b);
  const labelAt = (t: number) => {
    const i = audioEdges.filter((b) => b <= t).length;
    return input.labels[i] ?? input.labels.at(-1) ?? "A";
  };
  const snap = (t: number) => {
    const d = nearest(input.downbeats, t);
    return d !== undefined && Math.abs(d - t) <= 1.5 ? d : t;
  };
  let cuts = audioEdges.map(snap);
  const first = lines[0];
  const last = lines.at(-1);
  if (
    first &&
    first.start >= 6 &&
    !cuts.some((c) => Math.abs(c - first.start) < 2)
  )
    cuts.push(snap(first.start));
  if (
    last &&
    duration - last.end >= 6 &&
    !cuts.some((c) => Math.abs(c - last.end) < 2)
  )
    cuts.push(snap(last.end));
  // A section starting with a line starts on its downbeat when one is that close.
  const snapLine = (t: number) => {
    const d = nearest(input.downbeats, t);
    return d !== undefined && Math.abs(d - t) <= 0.4 ? d : t;
  };
  // A boundary inside a sung line moves to the line start.
  cuts = cuts.map((c) => {
    const inside = lines.find((l) => c > l.start + 0.3 && c < l.end - 0.3);
    return inside ? snapLine(inside.start) : c;
  });
  cuts.sort((a, b) => a - b);
  const edges = [0];
  for (const c of cuts)
    if (c - (edges.at(-1) ?? 0) >= 1 && duration - c >= 1) edges.push(round(c));
  edges.push(round(duration));

  let segments: Segment[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const start = edges[i] ?? 0;
    const end = edges[i + 1] ?? duration;
    segments.push({
      start,
      end,
      lines: [],
      audioLabel: labelAt((start + end) / 2),
    });
  }
  // Very short segments join the previous one.
  segments = segments.reduce<Segment[]>((acc, s) => {
    const previous = acc.at(-1);
    if (previous && s.end - s.start < 4) previous.end = s.end;
    else acc.push(s);
    return acc;
  }, []);
  lines.forEach((l, i) => {
    const mid = (l.start + l.end) / 2;
    const seg =
      segments.find((s) => mid >= s.start && mid < s.end) ?? segments.at(-1);
    seg?.lines.push(i);
  });

  const repeated = findRepeatedLines(lines);
  // The lyrics refine the audio: a segment whose new lines give way to repeated ones
  // (a bridge running into the last chorus) splits where the repetition starts.
  segments = segments.flatMap((s) => {
    const flags = s.lines.map((l) => repeated.has(l));
    for (let k = 2; k <= flags.length - 2; k++) {
      const before = flags.slice(0, k);
      const after = flags.slice(k);
      const line = lines[s.lines[k] ?? -1];
      if (
        line &&
        before.every((f) => f === before[0]) &&
        after.every((f) => f !== before[0])
      ) {
        const cut = round(snapLine(line.start));
        if (cut - s.start < 4 || s.end - cut < 4) break;
        return [
          { ...s, end: cut, lines: s.lines.slice(0, k) },
          { ...s, start: cut, lines: s.lines.slice(k) },
        ];
      }
    }
    return [s];
  });
  const lyric = segments.filter((s) => s.lines.length > 0);
  const firstLyric = segments.indexOf(lyric[0] as Segment);
  const lastLyric = segments.indexOf(lyric.at(-1) as Segment);
  const energyOf = (s: { start: number; end: number }) => {
    const points = input.energy.filter((p) => p.t >= s.start && p.t < s.end);
    return points.length
      ? Math.min(
          1,
          Math.max(0, points.reduce((sum, p) => sum + p.v, 0) / points.length),
        )
      : 0;
  };
  segments.forEach((s, i) => {
    if (s.lines.length === 0)
      s.kind =
        i < firstLyric || firstLyric < 0
          ? "intro"
          : i > lastLyric
            ? "outro"
            : "instrumental";
    else if (
      s.lines.filter((l) => repeated.has(l)).length * 2 >=
      s.lines.length
    )
      s.kind = "chorus";
  });
  if (!segments.some((s) => s.kind === "chorus")) {
    // No sung repetition: the loudest audio pattern that comes back is the chorus.
    const byLabel = new Map<string, Segment[]>();
    for (const s of lyric)
      byLabel.set(s.audioLabel, [...(byLabel.get(s.audioLabel) ?? []), s]);
    const candidates = [...byLabel.values()].filter(
      (group) => group.length >= 2,
    );
    const mean = (group: Segment[]) =>
      group.reduce((sum, s) => sum + energyOf(s), 0) / group.length;
    const chorus = candidates.sort((a, b) => mean(b) - mean(a))[0];
    for (const s of chorus ?? []) s.kind = "chorus";
  }
  const choruses = segments.filter((s) => s.kind === "chorus");
  const secondChorus = segments.indexOf(choruses[1] as Segment);
  segments.forEach((s, i) => {
    if (s.kind) return;
    const next = segments[i + 1];
    const previous = segments[i - 1];
    const seenBefore = segments
      .slice(0, i)
      .some((x) => x.audioLabel === s.audioLabel);
    if (
      secondChorus >= 0 &&
      i > secondChorus &&
      !seenBefore &&
      !s.lines.some((l) => repeated.has(l))
    )
      s.kind = "bridge";
    else if (
      next?.kind === "chorus" &&
      previous?.kind === "verse" &&
      s.end - s.start < 12
    )
      s.kind = "pre-chorus";
    else s.kind = "verse";
  });
  // A chorus that the audio split late takes back its first repeated lines.
  segments.forEach((s, i) => {
    const previous = segments[i - 1];
    if (s.kind !== "chorus" || !previous || previous.kind === "chorus") return;
    while (previous.lines.length > 1) {
      const l = previous.lines.at(-1) ?? -1;
      const line = lines[l];
      if (!line || !repeated.has(l)) break;
      const cut = round(snapLine(line.start));
      if (cut <= previous.start) break;
      previous.lines.pop();
      s.lines.unshift(l);
      previous.end = cut;
      s.start = cut;
    }
  });

  // Merge runs of the same kind that belong together.
  const merged = segments.reduce<Segment[]>((acc, s) => {
    const previous = acc.at(-1);
    const short = (x: Segment) => x.end - x.start < 12;
    if (
      previous &&
      previous.kind === s.kind &&
      (s.kind === "instrumental" ||
        s.kind === "intro" ||
        s.kind === "outro" ||
        (short(previous) && short(s)))
    ) {
      previous.end = s.end;
      previous.lines.push(...s.lines);
    } else acc.push({ ...s, lines: [...s.lines] });
    return acc;
  }, []);

  const totals = new Map<SectionKind, number>();
  for (const s of merged)
    totals.set(s.kind ?? "verse", (totals.get(s.kind ?? "verse") ?? 0) + 1);
  const counters = new Map<SectionKind, number>();
  const NAMES: Record<SectionKind, string> = {
    intro: "Intro",
    verse: "Verse",
    "pre-chorus": "Pre-Chorus",
    chorus: "Chorus",
    "post-chorus": "Post-Chorus",
    bridge: "Bridge",
    instrumental: "Instrumental",
    outro: "Outro",
  };
  return merged.map((s) => {
    const kind = s.kind ?? "verse";
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    const numbered =
      kind === "verse" ||
      kind === "chorus" ||
      kind === "pre-chorus" ||
      (totals.get(kind) ?? 0) > 1;
    return {
      id: `${kind}-${n}`,
      kind,
      label: numbered ? `${NAMES[kind]} ${n}` : NAMES[kind],
      start: s.start,
      end: s.end,
      audioLabel: s.audioLabel,
      energy: Math.round(energyOf(s) * 1000) / 1000,
    };
  });
}

export function analyseLines(
  lines: TimedLine[],
  sections: Section[],
  beats: number[],
  lang: string,
): AnalysedLine[] {
  return lines.map((line, index) => {
    const mid = (line.start + line.end) / 2;
    const section =
      sections.find((s) => mid >= s.start && mid < s.end) ?? sections.at(-1);
    return {
      index,
      sectionId: section?.id ?? "",
      start: line.start,
      end: line.end,
      text: line.text,
      syllables: countSyllables(line.text, lang),
      ending: lineEnding(line.text, lang),
      beats: beats.filter((b) => b >= line.start && b <= line.end).length,
    };
  });
}
