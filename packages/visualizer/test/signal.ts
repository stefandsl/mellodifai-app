import { ANALYSIS_RATE } from "@mellodifai/shared";

// A steady test signal both sides of the comparison analyse: bass, mid and treble tones over
// seeded noise, the same samples every run.
export const SIGNAL_SECONDS = 4;
export function testSignal(): Float32Array {
  const n = SIGNAL_SECONDS * ANALYSIS_RATE;
  const out = new Float32Array(n);
  let seed = 1234567;
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    const noise = ((seed >>> 8) / 16777216 - 0.5) * 0.04;
    const t = i / ANALYSIS_RATE;
    out[i] =
      0.4 * Math.sin(2 * Math.PI * 70 * t) +
      0.15 * Math.sin(2 * Math.PI * 440 * t) +
      0.08 * Math.sin(2 * Math.PI * 3000 * t) +
      noise;
  }
  return out;
}
