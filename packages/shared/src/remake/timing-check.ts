// "Keeps timing" (design AC11): same section sequence, tempo within 5%, each section's
// duration within 15% of the source. Used on a new take against the source blueprint.

export type TimedSection = { label: string; startS: number; endS: number };
export type TimingCheck = {
  ok: boolean;
  sequenceOk: boolean;
  tempoRatio: number;
  tempoOk: boolean;
  sections: {
    index: number;
    label: string;
    sourceS: number;
    takeS: number;
    ratio: number;
    ok: boolean;
  }[];
  reasons: string[];
};

export const TEMPO_TOLERANCE = 0.05;
export const SECTION_TOLERANCE = 0.15;

export function keepsTiming(
  source: { bpm: number; sections: TimedSection[] },
  take: { bpm: number; sections: TimedSection[] },
): TimingCheck {
  const reasons: string[] = [];
  const sequenceOk =
    source.sections.length === take.sections.length &&
    source.sections.every((s, i) => s.label === take.sections[i]?.label);
  if (!sequenceOk)
    reasons.push(
      `section sequence differs: ${source.sections.map((s) => s.label).join(" ")} vs ${take.sections.map((s) => s.label).join(" ")}`,
    );
  const tempoRatio = source.bpm > 0 ? take.bpm / source.bpm : 0;
  const tempoOk = Math.abs(tempoRatio - 1) <= TEMPO_TOLERANCE;
  if (!tempoOk)
    reasons.push(
      `tempo ${take.bpm} vs ${source.bpm} BPM is off by more than 5%`,
    );
  const sections = source.sections.map((s, index) => {
    const t = take.sections[index];
    const sourceS = s.endS - s.startS;
    const takeS = t ? t.endS - t.startS : 0;
    const ratio = sourceS > 0 ? takeS / sourceS : 0;
    const ok = Boolean(t) && Math.abs(ratio - 1) <= SECTION_TOLERANCE;
    if (!ok)
      reasons.push(
        `section ${index + 1} (${s.label}) lasts ${takeS.toFixed(1)} s vs ${sourceS.toFixed(1)} s`,
      );
    return {
      index,
      label: s.label,
      sourceS,
      takeS,
      ratio: Math.round(ratio * 1000) / 1000,
      ok,
    };
  });
  return {
    ok: sequenceOk && tempoOk && sections.every((s) => s.ok),
    sequenceOk,
    tempoRatio: Math.round(tempoRatio * 1000) / 1000,
    tempoOk,
    sections,
    reasons,
  };
}
