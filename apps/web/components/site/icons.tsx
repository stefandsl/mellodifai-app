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

export function ChevronLeftGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  );
}

export function ChevronRightGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function VolumeGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M2.5 6.25h2.5l3.25-2.75v9L5 9.75H2.5z" />
      <path d="M11 5.75a3.25 3.25 0 0 1 0 4.5M12.75 4a5.75 5.75 0 0 1 0 8" />
    </svg>
  );
}

export function VolumeMuteGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M2.5 6.25h2.5l3.25-2.75v9L5 9.75H2.5z" />
      <path d="M10.75 6 14 9.25M14 6l-3.25 3.25" />
    </svg>
  );
}

export function FullscreenGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M2.75 6V2.75H6M10 2.75h3.25V6M13.25 10v3.25H10M6 13.25H2.75V10" />
    </svg>
  );
}

export function ExitFullscreenGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M6 2.75V6H2.75M13.25 6H10V2.75M10 13.25V10h3.25M2.75 10H6v3.25" />
    </svg>
  );
}

export function DownloadGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M8 2.5v7.5M5 7.25 8 10.25l3-3M3 12.75h10" />
    </svg>
  );
}

export function WindowsGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M2.5 3.5h4.75v3.75H2.5zM8.75 3.5h4.75v3.75H8.75zM2.5 8.75h4.75v3.75H2.5zM8.75 8.75h4.75v3.75H8.75z" />
    </svg>
  );
}

export function MonitorGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <rect x="2.25" y="3" width="11.5" height="7.75" rx="1.25" />
      <path d="M5.5 13h5M8 10.75V13" />
    </svg>
  );
}
