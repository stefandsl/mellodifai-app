import type { StemName } from "./stems";

// Which stems the page plays. All four always run together so they stay in sync; the ones not
// heard are muted. Solo wins over mute: with any stem on solo, only soloed stems are heard.
export type Mix = { solo: StemName[]; muted: StemName[] };

export const FULL_MIX: Mix = { solo: [], muted: [] };

export function audible(mix: Mix, name: StemName): boolean {
  return mix.solo.length ? mix.solo.includes(name) : !mix.muted.includes(name);
}

const toggle = (list: StemName[], name: StemName) =>
  list.includes(name) ? list.filter((item) => item !== name) : [...list, name];

export function toggleSolo(mix: Mix, name: StemName): Mix {
  return { ...mix, solo: toggle(mix.solo, name) };
}

export function toggleMute(mix: Mix, name: StemName): Mix {
  return { ...mix, muted: toggle(mix.muted, name) };
}

// The row's play button plays that stem on its own.
export function only(name: StemName): Mix {
  return { solo: [name], muted: [] };
}

export function isOnly(mix: Mix, name: StemName): boolean {
  return mix.solo.length === 1 && mix.solo[0] === name;
}

export function isFullMix(mix: Mix): boolean {
  return mix.solo.length === 0 && mix.muted.length === 0;
}

// What a row's play button does: pause when it is the one stem playing, else play it alone.
export function rowPress(
  mix: Mix,
  playing: boolean,
  name: StemName,
): { mix: Mix; playing: boolean } {
  if (playing && isOnly(mix, name)) return { mix, playing: false };
  return { mix: only(name), playing: true };
}

// Seconds left from the progress so far, or null while it is too early to tell.
export function remaining(elapsed: number, percent: number): number | null {
  if (percent < 8 || percent >= 100 || elapsed < 10) return null;
  return (elapsed * (100 - percent)) / percent;
}
