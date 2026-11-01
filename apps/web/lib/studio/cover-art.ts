// Procedural covers for songs that have no artwork yet: pure CSS `background` values, chosen
// deterministically from the song id. Six pattern families, all in the brand's reds, oranges,
// pinks and violets over a deep ink, so white text on top stays readable in both themes.

export const COVER_FAMILIES = [
  "mesh",
  "orbs",
  "rays",
  "waves",
  "conic",
  "blobs",
] as const;
export type CoverFamily = (typeof COVER_FAMILIES)[number];

// FNV-1a with a final avalanche, so ids that differ in one character land far apart.
function hashOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

// A small seeded generator (mulberry32) for the pattern's numbers.
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function coverFamily(id: string): CoverFamily {
  return COVER_FAMILIES[hashOf(id) % COVER_FAMILIES.length] as CoverFamily;
}

// Brand-friendly hues: crimson, red, vermilion, amber-orange, rose, magenta, orchid, violet.
const HUES = [352, 4, 14, 26, 336, 316, 290, 266];

const pct = (value: number) => `${Math.round(value)}%`;

export function artFor(id: string): string {
  const hash = hashOf(id);
  const rand = rng(hash ^ 0x9e3779b9);
  const between = (low: number, high: number) => low + rand() * (high - low);
  const hue = HUES[Math.floor(rand() * HUES.length)] as number;
  const warm = (hue + between(10, 24)) % 360;
  const cool = (hue + 360 - between(20, 40)) % 360;
  const accent = (alpha = 1) =>
    `hsl(${hue} ${Math.round(between(74, 90))}% ${Math.round(between(46, 56))}% / ${alpha})`;
  const second = (alpha = 1) =>
    `hsl(${warm} ${Math.round(between(70, 88))}% ${Math.round(between(52, 62))}% / ${alpha})`;
  const third = (alpha = 1) =>
    `hsl(${cool} ${Math.round(between(60, 78))}% ${Math.round(between(32, 44))}% / ${alpha})`;
  const inkHue = (hue + 8) % 360;
  const ink = `hsl(${inkHue} 32% 8%)`;
  const inkSoft = `hsl(${inkHue} 36% 15%)`;
  const angle = Math.round(between(0, 360));
  const at = () => `${pct(between(8, 92))} ${pct(between(8, 92))}`;

  switch (coverFamily(id)) {
    case "mesh":
      return [
        `radial-gradient(at ${at()}, ${accent()} 0, transparent 58%)`,
        `radial-gradient(at ${at()}, ${second(0.9)} 0, transparent 52%)`,
        `radial-gradient(at ${at()}, ${third()} 0, transparent 60%)`,
        `linear-gradient(${angle}deg, ${inkSoft}, ${ink})`,
      ].join(", ");
    case "orbs": {
      const orb = (color: string, size: number) => {
        const where = at();
        return [
          `radial-gradient(circle at ${where}, ${color} 0, ${color} ${pct(size)}, transparent ${pct(size + 1)})`,
          `radial-gradient(circle at ${where}, ${color.replace(/\/ [\d.]+\)$/u, "/ 0.3)")} 0, transparent ${pct(size * 3.2)})`,
        ];
      };
      return [
        ...orb(accent(), between(9, 16)),
        ...orb(second(), between(6, 12)),
        ...orb(third(), between(10, 18)),
        `linear-gradient(${angle}deg, ${inkSoft}, ${ink})`,
      ].join(", ");
    }
    case "rays": {
      const step = between(6, 14);
      const origin = `${pct(between(20, 80))} ${pct(between(55, 110))}`;
      return [
        `radial-gradient(circle at ${origin}, ${second(0.85)} 0, transparent 38%)`,
        `repeating-conic-gradient(from ${angle}deg at ${origin}, ${accent(0.55)} 0 ${step.toFixed(1)}deg, transparent ${step.toFixed(1)}deg ${(step * 2).toFixed(1)}deg)`,
        `linear-gradient(${angle}deg, ${inkSoft}, ${ink})`,
      ].join(", ");
    }
    case "waves": {
      const gap = between(5, 9);
      return [
        `repeating-radial-gradient(ellipse at ${pct(between(0, 40))} 125%, transparent 0 ${gap.toFixed(1)}%, ${accent(0.6)} ${gap.toFixed(1)}% ${(gap + 1.6).toFixed(1)}%)`,
        `repeating-radial-gradient(ellipse at ${pct(between(60, 100))} -25%, transparent 0 ${(gap + 2).toFixed(1)}%, ${second(0.4)} ${(gap + 2).toFixed(1)}% ${(gap + 3.2).toFixed(1)}%)`,
        `linear-gradient(${angle}deg, ${third(0.55)}, transparent 70%)`,
        `linear-gradient(${angle}deg, ${inkSoft}, ${ink})`,
      ].join(", ");
    }
    case "conic": {
      const where = at();
      return [
        `radial-gradient(circle at ${where}, ${ink} 0, transparent 46%)`,
        `conic-gradient(from ${angle}deg at ${where}, ${accent()}, ${second()}, ${third()}, ${inkSoft}, ${accent()})`,
      ].join(", ");
    }
    case "blobs": {
      const blob = (color: string) =>
        `radial-gradient(ellipse ${pct(between(26, 46))} ${pct(between(22, 40))} at ${at()}, ${color} 0 62%, transparent 64%)`;
      return [
        blob(accent(0.95)),
        blob(second(0.8)),
        blob(third(0.9)),
        `linear-gradient(${angle}deg, ${inkSoft}, ${ink})`,
      ].join(", ");
    }
  }
}
