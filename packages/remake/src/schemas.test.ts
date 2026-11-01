import { describe, expect, it } from "vitest";
import {
  AnalysisSchema,
  BlueprintSchema,
  IngestManifestSchema,
  RewriteResultSchema,
} from "./schemas.js";
import { analysisFixture, blueprintFixture, must } from "./test-fixtures.js";

describe("blueprint schema", () => {
  it("accepts a valid blueprint", () => {
    expect(BlueprintSchema.parse(blueprintFixture())).toMatchObject({
      schemaVersion: 1,
    });
  });

  it("rejects overlapping or unsorted shots", () => {
    const bp = blueprintFixture();
    bp.shots[1] = { ...must(bp.shots[1]), start: 1 };
    expect(BlueprintSchema.safeParse(bp).success).toBe(false);
  });

  it("rejects a shot that ends after the video", () => {
    const bp = blueprintFixture();
    must(bp.shots.at(-1)).end = bp.durationS + 5;
    expect(BlueprintSchema.safeParse(bp).success).toBe(false);
  });

  it("rejects colours that are not hex", () => {
    const bp = blueprintFixture();
    must(bp.palette[0]).hex = "red";
    expect(BlueprintSchema.safeParse(bp).success).toBe(false);
  });

  it("rejects a future schema version", () => {
    expect(
      BlueprintSchema.safeParse({ ...blueprintFixture(), schemaVersion: 2 })
        .success,
    ).toBe(false);
  });
});

describe("analysis schema", () => {
  it("accepts a valid analysis", () => {
    const parsed = AnalysisSchema.parse(analysisFixture());
    expect(parsed.music.sections).toHaveLength(3);
  });

  it("rejects a line that points at a missing section", () => {
    const a = analysisFixture();
    must(a.lines[0]).sectionId = "nope";
    const result = AnalysisSchema.safeParse(a);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("unknown section");
  });

  it("rejects a meaning map entry for a missing section", () => {
    const a = analysisFixture();
    must(a.meaning[0]).sectionId = "ghost";
    expect(AnalysisSchema.safeParse(a).success).toBe(false);
  });

  it("rejects blueprint shots pointing at a missing section", () => {
    const a = analysisFixture();
    must(a.blueprint.shots[0]).sectionId = "ghost";
    expect(AnalysisSchema.safeParse(a).success).toBe(false);
  });

  it("rejects sections out of order", () => {
    const a = analysisFixture();
    const [s0, s1] = a.music.sections;
    a.music.sections[0] = must(s1);
    a.music.sections[1] = must(s0);
    expect(AnalysisSchema.safeParse(a).success).toBe(false);
  });

  it("rejects a BPM outside the musical range", () => {
    const a = analysisFixture();
    a.music.bpm = 900;
    expect(AnalysisSchema.safeParse(a).success).toBe(false);
  });
});

describe("ingest manifest schema", () => {
  it("accepts a manifest without captions", () => {
    expect(
      IngestManifestSchema.safeParse({
        schemaVersion: 1,
        videoId: "abc123def45",
        url: "https://www.youtube.com/watch?v=abc123def45",
        title: "Song",
        uploader: "Artist",
        durationS: 120,
        license: "Creative Commons Attribution license (reuse allowed)",
        language: "en",
        tags: [],
        description: "",
        files: {
          dir: "E:/x",
          audio: "E:/x/audio.wav",
          video: null,
          info: "E:/x/source.info.json",
          captions: null,
        },
        transcript: { source: "none", language: "en", lines: [] },
        frames: { sceneCuts: [], contactSheets: [] },
        createdAt: "2026-11-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("rewrite result schema", () => {
  it("requires every jury score between 0 and 1", () => {
    const result = {
      schemaVersion: 1,
      lang: "it",
      country: null,
      title: "Titolo",
      styleTags: ["pop"],
      sections: [],
      lyricsText: "",
      originality: {
        thresholds: {
          lexical: 0.6,
          semantic: 0.88,
          sharedRun: 4,
        },
        flaggedLines: 0,
        maxLexical: 0,
        maxSemantic: 0,
        semanticAvailable: false,
      },
      jury: {
        passed: true,
        rounds: [
          {
            round: 1,
            scores: { singability: 1.2 },
            failing: [],
            issues: [],
            devil: { blockers: [], objections: [] },
            verdicts: [],
            passed: true,
          },
        ],
        stoppedBecause: "passed",
      },
      cost: { usd: 0, calls: [] },
    };
    expect(RewriteResultSchema.safeParse(result).success).toBe(false);
  });
});
