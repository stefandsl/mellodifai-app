"use client";

import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";

// A switch between a few choices (billing period, agent): a real radio group with one tab stop,
// where the arrow keys move the choice. The Astryx control draws the moving thumb.
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <SegmentedControl
      label={label}
      value={value}
      onChange={(v) => onChange(v as T)}
      className={className ? `site-segmented ${className}` : "site-segmented"}
    >
      {options.map((o) => (
        <SegmentedControlItem key={o.value} value={o.value} label={o.label} />
      ))}
    </SegmentedControl>
  );
}
