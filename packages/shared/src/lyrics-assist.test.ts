import { describe, expect, it } from "vitest";
import {
  keepsStatusOnFailure,
  LyricsAssistInputSchema,
  lyricSectionsOf,
  sectionAt,
  spliceSection,
  stageAllowed,
} from "./index.js";

const TEXT = "[Verse 1]\nuno\ndue\n\n[Chorus]\ntre\nquattro\n\n[Outro]\ncinque";

describe("lyrics sections", () => {
  it("finds every tagged block and the one the caret is in", () => {
    expect(lyricSectionsOf(TEXT).map((b) => b.label)).toEqual([
      "Verse 1",
      "Chorus",
      "Outro",
    ]);
    const chorus = sectionAt(TEXT, TEXT.indexOf("quattro"));
    expect(chorus?.label).toBe("Chorus");
    expect(TEXT.slice(chorus?.start, chorus?.end)).toBe(
      "[Chorus]\ntre\nquattro\n\n",
    );
    expect(sectionAt("no tags here", 3)).toBeNull();
  });

  it("puts a new section in place and keeps the others verbatim", () => {
    const chorus = sectionAt(TEXT, TEXT.indexOf("tre"));
    if (!chorus) throw new Error("chorus missing");
    expect(spliceSection(TEXT, chorus, "[Chorus]\nsei\nsette\n")).toBe(
      "[Verse 1]\nuno\ndue\n\n[Chorus]\nsei\nsette\n\n[Outro]\ncinque",
    );
    const outro = sectionAt(TEXT, TEXT.length);
    if (!outro) throw new Error("outro missing");
    expect(spliceSection(TEXT, outro, "[Outro]\notto")).toBe(
      "[Verse 1]\nuno\ndue\n\n[Chorus]\ntre\nquattro\n\n[Outro]\notto",
    );
  });
});

describe("LyricsAssistInputSchema", () => {
  it("needs something to write from, or lyrics to work on", () => {
    expect(
      LyricsAssistInputSchema.safeParse({ mode: "write", lang: "it" }).success,
    ).toBe(false);
    expect(
      LyricsAssistInputSchema.safeParse({
        mode: "write",
        lang: "it",
        brief: "estate al mare",
      }).success,
    ).toBe(true);
    expect(
      LyricsAssistInputSchema.safeParse({ mode: "improve", lang: "en" })
        .success,
    ).toBe(false);
    expect(
      LyricsAssistInputSchema.safeParse({
        mode: "regenerate",
        lang: "en",
        lyrics: "[Verse]\nx",
        section: { start: 0, end: 50 },
      }).success,
    ).toBe(false);
    expect(
      LyricsAssistInputSchema.safeParse({
        mode: "regenerate",
        lang: "xx",
        lyrics: "x",
      }).success,
    ).toBe(false);
  });
});

describe("remake stages", () => {
  it("run only while the remake is analysing", () => {
    for (const stage of [
      "remake_ingest",
      "remake_analyse",
      "remake_rewrite",
    ] as const) {
      expect(stageAllowed("analysing", stage)).toBe(true);
      expect(stageAllowed("lyrics_review", stage)).toBe(false);
    }
    expect(stageAllowed("analysing", "generate_song")).toBe(false);
  });

  it("keep the remake alive when a review step fails", () => {
    expect(
      keepsStatusOnFailure({
        stage: "remake_rewrite",
        payload: { mode: "section" },
      }),
    ).toBe(true);
    expect(
      keepsStatusOnFailure({
        stage: "remake_rewrite",
        payload: { mode: "check" },
      }),
    ).toBe(true);
    expect(
      keepsStatusOnFailure({
        stage: "remake_rewrite",
        payload: { mode: "full" },
      }),
    ).toBe(false);
    expect(keepsStatusOnFailure({ stage: "remake_ingest" })).toBe(false);
    expect(keepsStatusOnFailure({ stage: "stems" })).toBe(true);
  });
});
