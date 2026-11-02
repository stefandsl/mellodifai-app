import { z } from "zod";
import {
  BLUEPRINT_SECTION_LABELS,
  BLUEPRINT_VOCALS,
  BlueprintSchema,
} from "./blueprint.js";

// Data contracts of the remake stages R1 (ingest), R2 (analyse) and R3 (rewrite lyrics),
// shared by the remake engine (packages/remake), the worker, the web app and MCP.
// Every JSON file the engine writes is parsed with one of these before it is saved.

const seconds = z.number().finite().nonnegative();
const unit = z.number().finite().min(0).max(1);

export const TimedLineSchema = z
  .object({ start: seconds, end: seconds, text: z.string().min(1) })
  .refine((line) => line.end >= line.start, "line ends before it starts");
export type TimedLine = z.infer<typeof TimedLineSchema>;

export const TranscriptSchema = z.object({
  source: z.enum(["captions", "whisper", "none"]),
  language: z.string().min(2),
  lines: z.array(TimedLineSchema),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

// R1 keeps at most 48 scene-cut frames (design 8.4) but every cut time.
export const MAX_SCENE_FRAMES = 48;

export const IngestManifestSchema = z.object({
  schemaVersion: z.literal(1),
  videoId: z.string().min(1),
  url: z.string().url(),
  title: z.string(),
  uploader: z.string(),
  durationS: seconds,
  license: z.string().nullable(),
  language: z.string().min(2),
  tags: z.array(z.string()),
  description: z.string(),
  files: z.object({
    dir: z.string(),
    audio: z.string(),
    video: z.string().nullable(),
    info: z.string(),
    captions: z.string().nullable(),
  }),
  transcript: TranscriptSchema,
  frames: z.object({
    cutTimes: z.array(seconds),
    sceneCuts: z
      .array(z.object({ t: seconds, file: z.string() }))
      .max(MAX_SCENE_FRAMES),
    contactSheets: z.array(
      z.object({
        file: z.string(),
        start: seconds,
        end: seconds,
        cols: z.number().int().positive(),
        rows: z.number().int().positive(),
      }),
    ),
  }),
  createdAt: z.string(),
});
export type IngestManifest = z.infer<typeof IngestManifestSchema>;

// One section vocabulary for the analysis and the blueprint.
export const SectionKindSchema = z.enum(BLUEPRINT_SECTION_LABELS);
export type SectionKind = z.infer<typeof SectionKindSchema>;

export const RemakeSectionSchema = z
  .object({
    id: z.string().min(1),
    kind: SectionKindSchema,
    // Display name, numbered: "Verse 1", "Chorus 2", "Instrumental".
    label: z.string().min(1),
    start: seconds,
    end: seconds,
    // Audio similarity cluster: the same letter means the music repeats.
    audioLabel: z.string(),
    energy: unit,
  })
  .refine((s) => s.end > s.start, "section must have a positive length");
export type RemakeSection = z.infer<typeof RemakeSectionSchema>;

export const EndingSchema = z.enum(["stressed", "unstressed", "unknown"]);
export type Ending = z.infer<typeof EndingSchema>;

const syllableRange = z.object({
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});

export const AnalysedLineSchema = z.object({
  index: z.number().int().nonnegative(),
  sectionId: z.string(),
  start: seconds,
  end: seconds,
  text: z.string().min(1),
  // Sung syllables: min merges vowels across words (synalepha), max does not.
  syllables: syllableRange,
  ending: EndingSchema,
  beats: z.number().int().nonnegative(),
});
export type AnalysedLine = z.infer<typeof AnalysedLineSchema>;

export const MusicAnalysisSchema = z.object({
  durationS: seconds,
  bpm: z.number().min(30).max(300),
  beatTracker: z.string(),
  key: z.object({
    tonic: z.string(),
    mode: z.enum(["major", "minor"]),
    confidence: z.number().finite(),
  }),
  timeSignature: z.object({
    beatsPerBar: z.number().int().min(2).max(12),
    confidence: unit,
  }),
  beats: z.array(seconds),
  downbeats: z.array(seconds),
  sections: z.array(RemakeSectionSchema).min(1),
  vocal: z.object({
    type: z.enum(BLUEPRINT_VOCALS),
    delivery: z.enum(["sung", "rap", "unknown"]),
    medianF0Hz: z.number().nullable(),
    voicedShare: unit.nullable(),
    pitchStability: unit.nullable(),
    notes: z.string(),
  }),
  instrumentation: z.object({
    stemShares: z
      .object({ vocals: unit, drums: unit, bass: unit, other: unit })
      .nullable(),
    inferred: z.array(z.string()).max(12),
  }),
  energy: z.array(z.object({ t: seconds, v: unit })),
});
export type MusicAnalysis = z.infer<typeof MusicAnalysisSchema>;

// Abstract descriptions of what a section says, never quoted lines (design 8.4 R2).
export const MeaningEntrySchema = z.object({
  sectionId: z.string(),
  theme: z.string().min(1),
  storyBeat: z.string().min(1),
  imagery: z.array(z.string()),
  emotionalArc: z.string().min(1),
  hookIdea: z.string(),
});
export type MeaningEntry = z.infer<typeof MeaningEntrySchema>;

export const RemakeCostSchema = z.object({
  usd: z.number().nonnegative(),
  calls: z.array(
    z.object({
      step: z.string(),
      model: z.string(),
      usd: z.number().nonnegative(),
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
      estimated: z.boolean(),
    }),
  ),
});
export type RemakeCost = z.infer<typeof RemakeCostSchema>;

export const RemakeAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    videoId: z.string(),
    url: z.string().url(),
    title: z.string(),
    // Names that must never reach the generator (artist, uploader, title words).
    protectedNames: z.array(z.string()),
    sourceLanguage: z.string().min(2),
    music: MusicAnalysisSchema,
    lines: z.array(AnalysedLineSchema),
    meaning: z.array(MeaningEntrySchema),
    overall: z.object({
      genre: z.array(z.string()),
      mood: z.array(z.string()),
      summary: z.string(),
    }),
    blueprint: BlueprintSchema,
    styleTags: z.array(z.string()),
    cost: RemakeCostSchema,
    // Design 14.3: source audio and video are deleted once R2 passes.
    sourceMediaDeleted: z.boolean(),
  })
  .superRefine((a, ctx) => {
    const ids = new Set(a.music.sections.map((s) => s.id));
    for (const [i, s] of a.music.sections.entries()) {
      const previous = a.music.sections[i - 1];
      if (previous && s.start < previous.end - 1e-6)
        ctx.addIssue({
          code: "custom",
          path: ["music", "sections", i],
          message: "sections must be sorted and must not overlap",
        });
    }
    const check = (sectionId: string, path: (string | number)[]) => {
      if (!ids.has(sectionId))
        ctx.addIssue({
          code: "custom",
          path,
          message: `unknown section ${sectionId}`,
        });
    };
    for (const [i, l] of a.lines.entries())
      check(l.sectionId, ["lines", i, "sectionId"]);
    for (const [i, m] of a.meaning.entries())
      check(m.sectionId, ["meaning", i, "sectionId"]);
    for (const [i, s] of a.blueprint.music.sections.entries())
      check(s.id, ["blueprint", "music", "sections", i, "id"]);
  });
export type RemakeAnalysis = z.infer<typeof RemakeAnalysisSchema>;

// Lyric jury of a remake (design 10.2): the existing criteria minus `topic` (a remake's
// topic is its meaning map, judged by meaning_fidelity) plus the three remake criteria.
export const REMAKE_JURY_CRITERIA = {
  language:
    "The lyrics are natural, correct and idiomatic in the target language, with no clumsy or machine-translated lines.",
  singable:
    "Lines have a steady meter and are easy to sing; stresses fall where a melody would put them.",
  chorus: "The chorus is catchy, memorable and repeatable.",
  original:
    "No line copies, closely paraphrases or literally translates a source line; the title and the hook are new.",
  meaning_fidelity:
    "Each section carries its meaning map (theme, story beat, imagery, emotional arc) in new words.",
  timing_fit:
    "Each line fits its slot: its sung syllable count matches the target given for that line (within one) and it can be sung in the line's duration.",
  youtube_safety:
    "Safe for YouTube: no artist, song or brand names, no copied phrases, no hate, harassment, explicit sexual content or dangerous instructions; advertiser friendly.",
} as const;
export type RemakeJuryCriterion = keyof typeof REMAKE_JURY_CRITERIA;
export const REMAKE_JURY_KEYS = Object.keys(
  REMAKE_JURY_CRITERIA,
) as RemakeJuryCriterion[];

const juryScores = z.object(
  Object.fromEntries(REMAKE_JURY_KEYS.map((k) => [k, unit])) as Record<
    RemakeJuryCriterion,
    typeof unit
  >,
);

export const RemakeIssueSchema = z.object({
  line: z.number().int().nullable(),
  problem: z.string(),
});
export type RemakeIssue = z.infer<typeof RemakeIssueSchema>;

export const RemakeVerdictSchema = z.object({
  model: z.string(),
  ms: z.number().nonnegative(),
  scores: juryScores.optional(),
  issues: z.array(RemakeIssueSchema).optional(),
  error: z.string().optional(),
});
export type RemakeVerdict = z.infer<typeof RemakeVerdictSchema>;

export const DEVIL_CATEGORIES = [
  "originality",
  "safety",
  "wrong_language",
  "singability",
  "meaning",
  "other",
] as const;
// A must_fix in these categories blocks the pass (design 10.2).
export const DEVIL_BLOCKING: readonly (typeof DEVIL_CATEGORIES)[number][] = [
  "originality",
  "safety",
  "wrong_language",
];

export const DevilObjectionSchema = z.object({
  category: z.enum(DEVIL_CATEGORIES),
  severity: z.enum(["must_fix", "note"]),
  line: z.number().int().nullable(),
  text: z.string(),
});
export type DevilObjection = z.infer<typeof DevilObjectionSchema>;

export const RemakeJuryRoundSchema = z.object({
  round: z.number().int().positive(),
  available: z.boolean(),
  scores: juryScores.partial(),
  failing: z.array(z.string()),
  issues: z.array(RemakeIssueSchema),
  devil: z.object({
    model: z.string(),
    objections: z.array(DevilObjectionSchema),
    blocking: z.number().int().nonnegative(),
    error: z.string().optional(),
  }),
  verdicts: z.array(RemakeVerdictSchema),
  gates: z.object({
    flaggedLines: z.number().int().nonnegative(),
    misfitLines: z.number().int().nonnegative(),
    phraseOk: z.boolean(),
    sectionsOk: z.boolean(),
  }),
  passed: z.boolean(),
});
export type RemakeJuryRound = z.infer<typeof RemakeJuryRoundSchema>;

// Binding starting values of design 10.3; calibration may only tighten them.
export const ORIGINALITY_THRESHOLDS = {
  lexical: 0.35,
  semantic: 0.8,
  phraseWords: 3,
  sectionMeaning: 0.55,
} as const;

export const OriginalityThresholdsSchema = z.object({
  lexical: unit.max(ORIGINALITY_THRESHOLDS.lexical),
  semantic: unit.max(ORIGINALITY_THRESHOLDS.semantic),
  phraseWords: z.number().int().min(1).max(ORIGINALITY_THRESHOLDS.phraseWords),
  sectionMeaning: unit.min(ORIGINALITY_THRESHOLDS.sectionMeaning),
});
export type OriginalityThresholds = z.infer<typeof OriginalityThresholdsSchema>;

export const LineOriginalitySchema = z.object({
  jaccard4: unit,
  rougeL: unit,
  semantic: unit.nullable(),
  closestSource: z.number().int().nullable(),
  against: z.enum(["source", "translation"]).nullable(),
  flagged: z.boolean(),
  reasons: z.array(z.string()),
});
export type LineOriginality = z.infer<typeof LineOriginalitySchema>;

export const RewrittenLineSchema = z.object({
  index: z.number().int().nonnegative(),
  source: z.string(),
  text: z.string().min(1),
  start: seconds,
  end: seconds,
  target: syllableRange.extend({ ending: EndingSchema }),
  syllables: syllableRange,
  ending: EndingSchema,
  fits: z.boolean(),
  originality: LineOriginalitySchema,
});
export type RewrittenLine = z.infer<typeof RewrittenLineSchema>;

export const RemakeLyricsSchema = z.object({
  schemaVersion: z.literal(1),
  lang: z.string().min(2),
  country: z.string().nullable(),
  title: z.string().min(1),
  styleTags: z.array(z.string()),
  sections: z.array(
    z.object({
      id: z.string(),
      kind: SectionKindSchema,
      label: z.string(),
      lines: z.array(RewrittenLineSchema),
    }),
  ),
  lyricsText: z.string(),
  originality: z.object({
    thresholds: OriginalityThresholdsSchema,
    embedder: z.string(),
    flaggedLines: z.number().int().nonnegative(),
    maxLexical: unit,
    maxSemantic: unit,
    phrase: z.object({
      ok: z.boolean(),
      longestRun: z.number().int().nonnegative(),
      detail: z.string(),
    }),
    // "enforce" (design 10.3) blocks the pass on a section under 0.55; "report" only
    // records it, pending the owner's calibration decision (see the task 24 report).
    meaningGate: z.enum(["enforce", "report"]),
    sections: z.array(
      z.object({
        sectionId: z.string(),
        meaningCosine: unit.nullable(),
        // The source section against its own meaning map: the reachable baseline.
        sourceCosine: unit.nullable(),
        ok: z.boolean(),
      }),
    ),
  }),
  jury: z.object({
    passed: z.boolean(),
    rounds: z.array(RemakeJuryRoundSchema),
    stoppedBecause: z.enum([
      "passed",
      "round_cap",
      "cost_cap",
      "jury_unavailable",
    ]),
  }),
  cost: RemakeCostSchema,
});
export type RemakeLyrics = z.infer<typeof RemakeLyricsSchema>;
