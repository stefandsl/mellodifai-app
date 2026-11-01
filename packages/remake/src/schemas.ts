// Versioned data contracts of the remake engine (R1 ingest, R2 analyse, R3 rewrite).
// Every JSON file the engine writes is parsed with one of these before it is saved,
// so a later stage (worker, web UI, an agent through MCP) can trust its shape.
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

const seconds = z.number().finite().nonnegative();
const unit = z.number().finite().min(0).max(1);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/u, "colour must be #rrggbb");

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

export const IngestManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
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
    sceneCuts: z.array(z.object({ t: seconds, file: z.string() })),
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

export const SECTION_KINDS = [
  "intro",
  "verse",
  "pre-chorus",
  "chorus",
  "post-chorus",
  "bridge",
  "instrumental",
  "outro",
] as const;
export const SectionKindSchema = z.enum(SECTION_KINDS);
export type SectionKind = z.infer<typeof SectionKindSchema>;

export const SectionSchema = z
  .object({
    id: z.string().min(1),
    kind: SectionKindSchema,
    label: z.string().min(1),
    start: seconds,
    end: seconds,
    // Index of the audio-similarity cluster (same letter = the music repeats).
    audioLabel: z.string(),
    energy: unit,
  })
  .refine((s) => s.end > s.start, "section must have a positive length");
export type Section = z.infer<typeof SectionSchema>;

export const EndingSchema = z.enum(["stressed", "unstressed", "unknown"]);
export type Ending = z.infer<typeof EndingSchema>;

export const AnalysedLineSchema = z.object({
  index: z.number().int().nonnegative(),
  sectionId: z.string(),
  start: seconds,
  end: seconds,
  text: z.string().min(1),
  // Sung syllables: min applies every vowel merge across words, max none.
  syllables: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  ending: EndingSchema,
  beats: z.number().int().nonnegative(),
});
export type AnalysedLine = z.infer<typeof AnalysedLineSchema>;

export const VOCAL_TYPES = [
  "male",
  "female",
  "mixed",
  "rap",
  "none",
  "unknown",
] as const;

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
  sections: z.array(SectionSchema).min(1),
  vocal: z.object({
    type: z.enum(VOCAL_TYPES),
    medianF0Hz: z.number().nullable(),
    voicedShare: unit.nullable(),
    pitchStability: unit.nullable(),
    notes: z.string(),
  }),
  instrumentation: z.object({
    stemShares: z
      .object({ vocals: unit, drums: unit, bass: unit, other: unit })
      .nullable(),
    inferred: z.array(z.string()),
  }),
  energy: z.array(z.object({ t: seconds, v: unit })),
});
export type MusicAnalysis = z.infer<typeof MusicAnalysisSchema>;

export const MeaningEntrySchema = z.object({
  sectionId: z.string(),
  theme: z.string().min(1),
  storyBeat: z.string().min(1),
  imagery: z.array(z.string()),
  emotionalArc: z.string().min(1),
  hookIdea: z.string(),
});
export type MeaningEntry = z.infer<typeof MeaningEntrySchema>;

export const TYPOGRAPHY_ROLES = [
  "title",
  "lyric",
  "accent",
  "caption",
  "credit",
] as const;

export const ShotSchema = z
  .object({
    id: z.string().min(1),
    start: seconds,
    end: seconds,
    sectionId: z.string(),
    // True when both edges sit within 80 ms of a beat.
    onBeat: z.boolean(),
    layout: z.string(),
    description: z.string(),
    motion: z.string(),
    transitionIn: z.string(),
    textOverlay: z.string().nullable(),
  })
  .refine((s) => s.end > s.start, "shot must have a positive length");
export type Shot = z.infer<typeof ShotSchema>;

export const BlueprintSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    sourceVideoId: z.string(),
    aspect: z.string().regex(/^\d+:\d+$/u),
    durationS: seconds,
    palette: z
      .array(z.object({ hex, role: z.string().min(1) }))
      .min(2)
      .max(8),
    typography: z.array(
      z.object({
        role: z.enum(TYPOGRAPHY_ROLES),
        style: z.string().min(1),
        case: z.enum(["upper", "lower", "title", "sentence", "mixed"]),
        weight: z.enum(["light", "regular", "bold", "black"]),
      }),
    ),
    motion: z.object({
      cutsPerMinute: z.number().nonnegative(),
      cutStyle: z.string(),
      zooms: z.string(),
      kineticText: z.string(),
      visualizer: z.string(),
      transitions: z.array(z.string()),
    }),
    shots: z.array(ShotSchema).min(1),
    notes: z.string(),
  })
  .superRefine((bp, ctx) => {
    bp.shots.forEach((shot, i) => {
      const previous = bp.shots[i - 1];
      if (previous && shot.start < previous.end - 1e-6)
        ctx.addIssue({
          code: "custom",
          path: ["shots", i, "start"],
          message: "shots must be sorted and must not overlap",
        });
      if (shot.end > bp.durationS + 0.5)
        ctx.addIssue({
          code: "custom",
          path: ["shots", i, "end"],
          message: "shot ends after the video",
        });
    });
  });
export type Blueprint = z.infer<typeof BlueprintSchema>;

export const CostCallSchema = z.object({
  step: z.string(),
  model: z.string(),
  usd: z.number().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  estimated: z.boolean(),
});
export const CostSchema = z.object({
  usd: z.number().nonnegative(),
  calls: z.array(CostCallSchema),
});
export type Cost = z.infer<typeof CostSchema>;

export const AnalysisSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    videoId: z.string(),
    title: z.string(),
    // Names that must never reach a prompt for the generator (artist, uploader, title).
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
    cost: CostSchema,
  })
  .superRefine((a, ctx) => {
    const ids = new Set(a.music.sections.map((s) => s.id));
    a.music.sections.forEach((s, i) => {
      const previous = a.music.sections[i - 1];
      if (previous && s.start < previous.end - 1e-6)
        ctx.addIssue({
          code: "custom",
          path: ["music", "sections", i],
          message: "sections must be sorted and must not overlap",
        });
    });
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
    for (const [i, s] of a.blueprint.shots.entries())
      check(s.sectionId, ["blueprint", "shots", i, "sectionId"]);
  });
export type Analysis = z.infer<typeof AnalysisSchema>;

export const JURY_CRITERIA = {
  singability:
    "Each line can be sung on the original line's notes: its syllable count and final stress match the target given for that line, the meter is steady, and the words flow naturally when sung.",
  meaning:
    "Each section carries the meaning map of the original section (theme, story beat, imagery, emotional arc) in new words.",
  originality:
    "No line copies, closely paraphrases or literally translates a line of the source lyrics; the title and the hook are new.",
  safety:
    "Safe for YouTube: no artist, song or brand names, no copied phrases, no hate, harassment, explicit sexual content or dangerous instructions; advertiser friendly.",
} as const;
export type JuryCriterion = keyof typeof JURY_CRITERIA;

const juryScores = z.object({
  singability: unit,
  meaning: unit,
  originality: unit,
  safety: unit,
});

export const VerdictSchema = z.object({
  model: z.string(),
  ms: z.number().nonnegative(),
  scores: juryScores.optional(),
  issues: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const JuryRoundSchema = z.object({
  round: z.number().int().positive(),
  scores: juryScores.partial(),
  failing: z.array(z.string()),
  issues: z.array(z.string()),
  devil: z.object({
    model: z.string().optional(),
    blockers: z.array(z.string()),
    objections: z.array(z.string()),
    error: z.string().optional(),
  }),
  verdicts: z.array(VerdictSchema),
  passed: z.boolean(),
});
export type JuryRound = z.infer<typeof JuryRoundSchema>;

export const LineOriginalitySchema = z.object({
  lexical: unit,
  semantic: unit.nullable(),
  sharedRun: z.number().int().nonnegative(),
  closestSource: z.number().int().nullable(),
  against: z.enum(["source", "translation"]).nullable(),
  flagged: z.boolean(),
  exempt: z.boolean(),
});
export type LineOriginality = z.infer<typeof LineOriginalitySchema>;

export const RewrittenLineSchema = z.object({
  index: z.number().int().nonnegative(),
  source: z.string(),
  text: z.string().min(1),
  start: seconds,
  end: seconds,
  target: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
    ending: EndingSchema,
  }),
  syllables: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  ending: EndingSchema,
  fits: z.boolean(),
  endingMatch: z.boolean(),
  originality: LineOriginalitySchema,
});
export type RewrittenLine = z.infer<typeof RewrittenLineSchema>;

export const RewriteResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
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
    thresholds: z.object({
      lexical: unit,
      semantic: unit,
      sharedRun: z.number().int().positive(),
    }),
    flaggedLines: z.number().int().nonnegative(),
    maxLexical: unit,
    maxSemantic: unit,
    semanticAvailable: z.boolean(),
    semanticError: z.string().optional(),
  }),
  jury: z.object({
    passed: z.boolean(),
    rounds: z.array(JuryRoundSchema),
    stoppedBecause: z.enum(["passed", "round-cap", "cost-cap", "no-jury"]),
  }),
  cost: CostSchema,
});
export type RewriteResult = z.infer<typeof RewriteResultSchema>;
