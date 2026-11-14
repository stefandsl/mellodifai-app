import type { ShotKind } from "./shot-list.js";

// The automated gates a generated draft must pass before anyone pays for its 1080p version.
// The thresholds were fixed on 2026-11-14 from controls, before any draft was measured:
// - lip sync: SyncNet on its published example clip gives offset 3 steps, confidence 10.02; the
//   same picture with 200 ms of audio delay moves the offset by exactly 5 steps; the picture
//   with a different song gives confidence 1.28. A sung shot needs at most 2 frames (at the
//   video's fps) of offset and confidence 3 or more.
// - identity: SigLIP2-base cosine of face crops; on the tutorial's performer the same face
//   scored 0.78-0.98 across two costumes and three shots, two other people scored 0.66-0.67.
//   The line is 0.75.
export const GATE_THRESHOLDS = {
  lipSyncMaxOffsetFrames: 2,
  lipSyncMinConfidence: 3,
  identityMinCosine: 0.75,
  durationMaxErrorFrames: 1,
  singleShotMaxCuts: 0,
} as const;

export type LipSyncScore = {
  // Frame-weighted median offset over the face tracks, in frames of the clip's fps.
  offsetFrames: number;
  confidence: number;
} | null;

export type IdentityScore = {
  faceCosine: number | null;
  fullCosine: number;
  facesFound: number;
} | null;

export type DraftMeasurements = {
  shot: { index: number; kind: ShotKind; sung: boolean; performer: boolean };
  fps: number;
  // Frames of the segment the draft replaces, and of the draft once trimmed to it.
  targetFrames: number;
  measuredFrames: number;
  // Scene changes inside the trimmed draft (ffmpeg scene score).
  sceneCuts: number;
  lipSync: LipSyncScore;
  identity: IdentityScore;
};

export type GateCheck = {
  gate: "duration" | "cuts" | "lip-sync" | "identity";
  value: number | null;
  limit: string;
  pass: boolean;
  note?: string;
};

export type GateResult = {
  index: number;
  kind: ShotKind;
  pass: boolean;
  checks: GateCheck[];
};

const single = (kind: ShotKind) => kind !== "burst";

export function evaluateDraftGates(m: DraftMeasurements): GateResult {
  const t = GATE_THRESHOLDS;
  const checks: GateCheck[] = [];
  const durationError = Math.abs(m.measuredFrames - m.targetFrames);
  checks.push({
    gate: "duration",
    value: durationError,
    limit: `<= ${t.durationMaxErrorFrames} frame`,
    pass: durationError <= t.durationMaxErrorFrames,
  });
  if (single(m.shot.kind))
    checks.push({
      gate: "cuts",
      value: m.sceneCuts,
      limit: `<= ${t.singleShotMaxCuts} in a single shot`,
      pass: m.sceneCuts <= t.singleShotMaxCuts,
    });
  if (m.shot.sung) {
    const sync = m.lipSync;
    const pass =
      sync !== null &&
      Math.abs(sync.offsetFrames) <= t.lipSyncMaxOffsetFrames &&
      sync.confidence >= t.lipSyncMinConfidence;
    checks.push({
      gate: "lip-sync",
      value: sync ? sync.offsetFrames : null,
      limit: `|offset| <= ${t.lipSyncMaxOffsetFrames} frames and confidence >= ${t.lipSyncMinConfidence}`,
      pass,
      note: sync
        ? `confidence ${sync.confidence}`
        : "no face track long enough to score",
    });
  }
  if (m.shot.performer) {
    const id = m.identity;
    const value = id ? (id.faceCosine ?? null) : null;
    checks.push({
      gate: "identity",
      value,
      limit: `face cosine >= ${t.identityMinCosine}`,
      pass: value !== null && value >= t.identityMinCosine,
      ...(!id
        ? { note: "not scored" }
        : id.faceCosine === null
          ? { note: `no face found (whole-image cosine ${id.fullCosine})` }
          : {}),
    });
  }
  return {
    index: m.shot.index,
    kind: m.shot.kind,
    pass: checks.every((c) => c.pass),
    checks,
  };
}

// Scene changes from ffmpeg's `select='gt(scene,T)',showinfo` log: one pts_time per change.
export function parseSceneCuts(log: string): number[] {
  return [...log.matchAll(/pts_time:([0-9.]+)/gu)].map((m) => Number(m[1]));
}
