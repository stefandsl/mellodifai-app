import { z } from "zod";

// What the worker stores in takes.scores once score_takes.py has heard the take.
export const TakeScoresSchema = z.object({
  // Share of the sung lyric tokens that Whisper hears, in order (0 to 1).
  fidelity: z.number().min(0).max(1),
  duration: z.number().nonnegative(),
  // Body level minus the level of the last 1.5 s, in dB: a fade is well above 12.
  endDropDb: z.number(),
  weakSections: z.array(z.string()),
  // The song stopped before the lyrics were done.
  truncated: z.boolean(),
});
export type TakeScores = z.infer<typeof TakeScoresSchema>;

export const MIN_SUGGEST_FIDELITY = 0.6;
export const MIN_FIDELITY_LEAD = 0.03;
export const ABRUPT_END_DB = 12;

export type TakeSuggestion = {
  takeId: string;
  reason: "fidelity" | "ending";
  // Set when the reason is fidelity.
  fidelity?: number;
};

// Scores come from a jsonb column that is {} until scoring lands.
export function parseTakeScores(value: unknown): TakeScores | null {
  const parsed = TakeScoresSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// The take the studio recommends, or null when the scores do not separate them.
export function suggestTake(
  takes: { id: string; scores: TakeScores | null }[],
): TakeSuggestion | null {
  const scored = takes.flatMap(({ id, scores }) =>
    scores ? [{ id, scores }] : [],
  );
  if (scored.length < 2 || scored.length !== takes.length) return null;
  const byFidelity = [...scored].sort(
    (a, b) => b.scores.fidelity - a.scores.fidelity,
  );
  const [best, next] = byFidelity;
  if (
    best &&
    next &&
    best.scores.fidelity >= MIN_SUGGEST_FIDELITY &&
    // The epsilon keeps a lead of exactly 0.03 from being lost to float rounding.
    best.scores.fidelity - next.scores.fidelity >= MIN_FIDELITY_LEAD - 1e-9
  )
    return {
      takeId: best.id,
      reason: "fidelity",
      fidelity: best.scores.fidelity,
    };
  const whole = scored.filter(
    ({ scores }) => !scores.truncated && scores.endDropDb > ABRUPT_END_DB,
  );
  const [only] = whole;
  return whole.length === 1 && only
    ? { takeId: only.id, reason: "ending" }
    : null;
}
