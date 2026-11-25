import type { SVGProps } from "react";

// Line icons of the site, drawn on a 16 unit grid; Astryx Icon sizes them.
const base = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function MenuGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M3 5.5h10M3 10.5h10" />
    </svg>
  );
}

export function CloseGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function PlayGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
    </svg>
  );
}

export function PauseGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M5.5 3.5v9M10.5 3.5v9" />
    </svg>
  );
}

export function ArrowGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M3 8h10M9.25 4.25 13 8l-3.75 3.75" />
    </svg>
  );
}

export function CheckGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function PlusGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function DashGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M4.5 8h7" />
    </svg>
  );
}

export function SearchGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <circle cx="7.25" cy="7.25" r="4.5" />
      <path d="M10.75 10.75 13.5 13.5" />
    </svg>
  );
}
