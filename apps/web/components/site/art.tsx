import { VStack } from "@astryxdesign/core/VStack";

// Drawings of the site. Every one is decoration (aria-hidden): the words around it carry the
// meaning. Shapes are computed, so no picture file is needed and the colours come from tokens.

// A small deterministic random source, so the server and the browser draw the same bars.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Bars of a waveform in a 0..width x 0..100 box; `phrases` sets how many sung phrases it shows. */
export function wavePath(
  seed: number,
  bars: number,
  step: number,
  phrases = 0,
) {
  const rnd = seeded(seed);
  let d = "";
  for (let i = 0; i < bars; i++) {
    const t = i / bars;
    const envelope = phrases
      ? Math.max(0.04, Math.sin(Math.PI * ((t * phrases) % 1)) ** 0.6)
      : 0.55 + 0.25 * Math.sin(t * 9);
    const h = Math.round(Math.min(46, 4 + envelope * (28 + rnd() * 16)));
    const x = Math.round(i * step + step / 2);
    d += `M${x} ${50 - h}V${50 + h}`;
  }
  return d;
}

export function Wave({
  seed,
  phrases,
  className,
  take,
}: {
  seed: number;
  phrases?: number;
  className?: string;
  take?: [number, number];
}) {
  const bars = 96;
  const step = 10;
  const all = wavePath(seed, bars, step, phrases);
  return (
    <svg
      className={`site-wave ${className ?? ""}`}
      viewBox={`0 0 ${bars * step} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={all} />
      {take ? (
        <rect
          className="site-wave__take"
          x={take[0] * bars * step}
          width={(take[1] - take[0]) * bars * step}
          y="0"
          height="100"
        />
      ) : null}
    </svg>
  );
}

/** The rule strip: fine ticks across the page, the top edge of the footer. */
export function Rule() {
  return (
    <svg
      className="site-rule"
      viewBox="0 0 2400 55"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={wavePath(7, 240, 10, 3).replaceAll(
          /M([\d.]+) ([\d.]+)V([\d.]+)/gu,
          (_m, x, a, b) =>
            `M${x} ${Math.round(27.5 - (50 - Number(a)) * 0.5)}V${Math.round(27.5 + (Number(b) - 50) * 0.5)}`,
        )}
      />
    </svg>
  );
}

export type CoverKind =
  | "remix"
  | "cover"
  | "satire"
  | "translation"
  | "karaoke"
  | "video"
  | "pantomime";

const RINGS: Record<CoverKind, [number, number, number][]> = {
  remix: [
    [122, 134, 7],
    [228, 102, 6],
  ],
  cover: [[212, 120, 5]],
  satire: [[170, 120, 6]],
  translation: [
    [110, 120, 5],
    [230, 120, 5],
  ],
  karaoke: [[170, 150, 7]],
  video: [
    [90, 90, 4],
    [250, 150, 5],
  ],
  pantomime: [[170, 100, 6]],
};

export function coverRings(kind: CoverKind): [number, number, number][] {
  return RINGS[kind];
}

/** A record sleeve: a mesh field in a dark frame with thin rings. */
export function Cover({
  kind,
  className,
}: {
  kind: CoverKind;
  className?: string;
}) {
  return (
    <VStack
      className={`site-cover site-cover--${kind} ${className ?? ""}`}
      aria-hidden="true"
    >
      <svg
        className="site-cover__art"
        viewBox="0 0 340 240"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        {RINGS[kind].map(([cx, cy, n]) => (
          <g key={`${cx}-${cy}`}>
            {Array.from({ length: n }, (_, i) => (i + 1) * 16).map((r) => (
              <circle key={r} cx={cx} cy={cy} r={r} />
            ))}
            <circle className="site-cover__dot" cx={cx} cy={cy} r="3" />
          </g>
        ))}
      </svg>
    </VStack>
  );
}
