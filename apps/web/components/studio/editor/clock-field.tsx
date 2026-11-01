"use client";

import { useEffect, useState } from "react";

import { formatClock, parseClock } from "@/lib/studio/audio-edit";

// A time field: shows m:ss.s, takes the same or plain seconds; Enter or leaving it commits.
export function ClockField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
}) {
  const [text, setText] = useState(formatClock(value, true));
  useEffect(() => setText(formatClock(value, true)), [value]);
  const commit = () => {
    const parsed = parseClock(text);
    if (parsed === null) setText(formatClock(value, true));
    else onCommit(parsed);
  };
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
      {label}
      <input
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            setText(formatClock(value, true));
          }
        }}
        className="h-9 w-full rounded-lg bg-[var(--surface-2)] px-3 text-[14px] tabular-nums text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      />
    </label>
  );
}
