import { describe, expect, it } from "vitest";

import {
  type CutPlanInput,
  type CutPlanLine,
  checkCutPlan,
  insideWord,
  MAX_SEGMENT_S,
  planCuts,
} from "./cut-plan.js";
import {
  BURST_CUTS,
  planShots,
  ShotListSchema,
  ShotSchema,
  sectionKind,
} from "./shot-list.js";

// A 120 BPM song: a beat every 0.5 s, a bar (downbeat) every 2 s. Each lyric line is four words
// over two bars; the third word is held across the bar line, so that downbeat is inside a word.
function song(): CutPlanInput {
  const duration = 100;
  const beats = Array.from({ length: 200 }, (_, i) => i * 0.5);
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const lines: CutPlanLine[] = [];
  const sections = [
    { name: "Intro", start: 0, end: 20 },
    { name: "Verse 1", start: 20, end: 52 },
    { name: "Chorus", start: 52, end: 84 },
    { name: "Outro", start: 84, end: 100 },
  ];
  let n = 0;
  for (let t = 20; t < 88; t += 4) {
    const section = t < 52 ? "Verse 1" : "Chorus";
    lines.push({
      section,
      text: `w${n} w${n + 1} w${n + 2} w${n + 3}`,
      words: [
        { w: `w${n}`, start: t + 0.05, end: t + 0.6 },
        { w: `w${n + 1}`, start: t + 0.7, end: t + 1.4 },
        { w: `w${n + 2}`, start: t + 1.5, end: t + 2.6 },
        { w: `w${n + 3}`, start: t + 2.7, end: t + 3.5 },
      ],
    });
    n += 4;
  }
  return { duration, lines, sections, downbeats, beats };
}

const allWords = (input: CutPlanInput) => input.lines.flatMap((l) => l.words);

describe("planCuts", () => {
  it("covers the whole song with contiguous segments and frames", () => {
    const input = song();
    const plan = planCuts(input);
    const check = checkCutPlan(plan, input);
    expect(check.reasons).toEqual([]);
    expect(check.ok).toBe(true);
    expect(plan.segments[0]?.start).toBe(0);
    expect(plan.segments.at(-1)?.end).toBe(100);
    expect(plan.frames).toBe(3000);
    plan.segments.forEach((s, i) => {
      const prev = plan.segments[i - 1];
      if (prev) {
        expect(s.start).toBe(prev.end);
        expect(s.startFrame).toBe(prev.endFrame);
      }
    });
    expect(plan.segments.at(-1)?.endFrame).toBe(3000);
  });

  it("never cuts inside a word and keeps segments 8-15 s", () => {
    const input = song();
    const plan = planCuts(input);
    for (const s of plan.segments.slice(1))
      expect(insideWord(s.start, allWords(input))).toBe(false);
    for (const s of plan.segments) {
      expect(s.duration).toBeGreaterThanOrEqual(8);
      expect(s.duration).toBeLessThanOrEqual(15);
    }
    expect(checkCutPlan(plan, input).wordsCut).toBe(0);
  });

  it("puts every cut on a frame that is outside every word", () => {
    // Words back to back and off the frame grid, each bar line 0.013 s into a word: a cut on
    // that word's edge in seconds lands inside it once rounded to a frame (2.0 s is frame 60).
    const lines: CutPlanLine[] = [];
    for (let k = 0; k < 20; k++) {
      const s = 0.487 + 2 * k;
      lines.push({
        words: [0, 1, 2, 3].map((i) => ({
          w: `w${4 * k + i}`,
          start: s + 0.5 * i,
          end: s + 0.5 * i + (i === 3 ? 0.45 : 0.5),
        })),
      });
    }
    const downbeats = Array.from({ length: 21 }, (_, i) => 2 * i);
    const input: CutPlanInput = { duration: 42, lines, downbeats };
    const plan = planCuts(input);
    for (const s of plan.segments.slice(1)) {
      expect(s.start * 30).toBeCloseTo(s.startFrame, 9);
      expect(insideWord(s.startFrame / 30, allWords(input))).toBe(false);
    }
    expect(checkCutPlan(plan, input).ok).toBe(true);
  });

  it("cuts on downbeats at phrase ends when the song allows it", () => {
    const input = song();
    const plan = planCuts(input);
    for (const s of plan.segments.slice(1)) {
      expect(s.cutIn.kind).toBe("downbeat");
      expect(s.cutIn.phraseEnd).toBe(true);
      expect(input.downbeats).toContain(s.start);
      // A line here starts 0.05 s after the bar and lasts 3.5 s: a phrase-end bar is 4k s in.
      if (s.start > 20 && s.start < 88) expect((s.start - 20) % 4).toBe(0);
    }
  });

  it("makes instrumental stretches non-sung and gives sung ones their exact lyrics", () => {
    const input = song();
    const plan = planCuts(input);
    const first = plan.segments[0];
    expect(first?.sung).toBe(false);
    expect(first?.text).toBe("");
    expect(first?.end).toBeLessThanOrEqual(20);
    expect(plan.segments.at(-1)?.sung).toBe(false);
    const sung = plan.segments.filter((s) => s.sung);
    const words = sung.flatMap((s) => s.text.split(/\s+/u));
    expect(words).toEqual(allWords(input).map((w) => w.w));
    // One lyric line per text line.
    for (const s of sung)
      for (const line of s.text.split("\n"))
        expect(input.lines.map((l) => l.text)).toContain(line);
  });

  it("falls back to word gaps when every downbeat is inside a word", () => {
    // 60 s of words that each straddle a bar line, with 0.1 s gaps between them.
    const words = Array.from({ length: 30 }, (_, i) => ({
      w: `x${i}`,
      start: i * 2 - 0.5 + 0.05,
      end: i * 2 + 1.45,
    })).filter((w) => w.start > 0);
    const input: CutPlanInput = {
      duration: 60,
      lines: [{ section: "Verse", text: "", words }],
      downbeats: Array.from({ length: 30 }, (_, i) => i * 2 + 0.2),
    };
    const plan = planCuts(input);
    const check = checkCutPlan(plan, input);
    expect(check.wordsCut).toBe(0);
    expect(check.ok).toBe(true);
    expect(check.maxS).toBeLessThanOrEqual(MAX_SEGMENT_S);
    expect(plan.segments.length).toBeGreaterThan(1);
  });

  it("refuses a song it cannot cut under 30 s", () => {
    expect(() =>
      planCuts({
        duration: 80,
        lines: [{ words: [{ w: "loooong", start: 1, end: 79 }] }],
        downbeats: [10, 20, 30, 40],
      }),
    ).toThrow(/30 s/u);
  });

  it("the check catches a cut inside a word and a gap", () => {
    const input = song();
    const plan = planCuts(input);
    const second = plan.segments[1];
    const first = plan.segments[0];
    if (!first || !second) throw new Error("plan too short");
    // Move the first cut into the middle of word w0 (20.05-20.6 s) of the next segment.
    const broken = {
      ...plan,
      segments: [
        { ...first, end: 20.3 },
        { ...second, start: 20.4 },
        ...plan.segments.slice(2),
      ],
    };
    const check = checkCutPlan(broken, input);
    expect(check.ok).toBe(false);
    expect(check.wordsCut).toBe(1);
    expect(check.gaps).toBe(1);
  });

  it("the check judges a cut at its frame time, not its time in seconds", () => {
    // Word w0 starts at 20.05 s. A cut labelled 20.04 s is outside it in seconds, but if its
    // frame is 602 the picture changes at 20.0667 s, 17 ms after the word began.
    const input = song();
    const plan = planCuts(input);
    const first = plan.segments[0];
    const second = plan.segments[1];
    if (!first || !second) throw new Error("plan too short");
    const shifted = {
      ...plan,
      segments: [
        { ...first, end: 20.04, endFrame: 602 },
        { ...second, start: 20.04, startFrame: 602 },
        ...plan.segments.slice(2),
      ],
    };
    expect(insideWord(20.04, allWords(input))).toBe(false);
    expect(insideWord(602 / 30, allWords(input))).toBe(true);
    const check = checkCutPlan(shifted, input);
    expect(check.wordsCut).toBe(1);
    expect(check.ok).toBe(false);
  });
});

describe("planShots", () => {
  const input = song();
  const plan = planCuts(input);
  // Energy rises through the song, so the chorus is the loud part.
  const energy = {
    fps: 10,
    values: Array.from({ length: 1000 }, (_, i) =>
      i >= 520 && i < 840 ? 0.9 : 0.2,
    ),
  };

  it("gives every segment one valid shot of the right kind", () => {
    const list = planShots(plan, { genre: "nu-disco", energy });
    expect(ShotListSchema.parse(list)).toEqual(list);
    expect(list.shots.map((s) => s.segment)).toEqual(
      plan.segments.map((s) => s.index),
    );
    for (const shot of list.shots) {
      const segment = plan.segments[shot.segment];
      if (!segment?.sung) {
        expect(shot.kind).toBe("instrumental-broll");
        expect(shot.prompt).toMatch(/nobody sings/u);
      } else if (shot.sectionKind === "chorus") {
        expect(shot.kind).toBe("burst");
        expect(shot.burst).toHaveLength(BURST_CUTS);
        expect(shot.burst[0]).toBe(shot.camera);
        expect(new Set(shot.burst).size).toBe(BURST_CUTS);
      } else {
        expect(shot.kind).toBe("lipsync-single");
        expect(shot.prompt).toContain("A single continuous shot without cuts.");
      }
      if (segment?.sung) {
        expect(shot.lyrics).toBe(segment.text);
        expect(shot.prompt).toContain(segment.text.replace(/\n/gu, " / "));
        expect(shot.prompt).toContain("nu-disco");
      }
    }
  });

  it("never repeats a camera on consecutive shots and is deterministic", () => {
    const a = planShots(plan, { genre: "nu-disco", energy });
    const b = planShots(plan, { genre: "nu-disco", energy });
    expect(a).toEqual(b);
    a.shots.forEach((shot, i) => {
      if (i > 0) expect(shot.camera).not.toBe(a.shots[i - 1]?.camera);
    });
  });

  it("changes set and costume with the section", () => {
    const list = planShots(plan, { genre: "nu-disco", energy });
    const verse = list.shots.find((s) => s.sectionKind === "verse");
    const chorus = list.shots.find((s) => s.sectionKind === "chorus");
    expect(verse?.set).not.toBe(chorus?.set);
    expect(verse?.costume).not.toBe(chorus?.costume);
  });

  it("the schema rejects a burst without its cuts and a sung shot without lyrics", () => {
    const list = planShots(plan, { genre: "nu-disco", energy });
    const burst = list.shots.find((s) => s.kind === "burst");
    const single = list.shots.find((s) => s.kind === "lipsync-single");
    expect(ShotSchema.safeParse({ ...burst, burst: [] }).success).toBe(false);
    expect(ShotSchema.safeParse({ ...single, lyrics: "" }).success).toBe(false);
  });

  it("reads section kinds from Suno-style names", () => {
    expect(sectionKind("Pre-Chorus")).toBe("prechorus");
    expect(sectionKind("Post-Chorus")).toBe("chorus");
    expect(sectionKind("Final Chorus")).toBe("chorus");
    expect(sectionKind("Bridge")).toBe("bridge");
    expect(sectionKind("Verse 2")).toBe("verse");
    expect(sectionKind("Spoken Word")).toBe("outro");
    expect(sectionKind("Intro")).toBe("intro");
  });
});
