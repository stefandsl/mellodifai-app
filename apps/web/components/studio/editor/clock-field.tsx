"use client";

import { useState } from "react";

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
  // What is being typed, or null while the field only shows the value. The shown text is worked
  // out in the render: an effect that copied the value into the text ran after the first
  // keystroke when it came right after the mount, and put the old text back over it.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseClock(draft);
    setDraft(null);
    if (parsed !== null) onCommit(parsed);
  };
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
      {label}
      <input
        inputMode="decimal"
        value={draft ?? formatClock(value, true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            setDraft(null);
          }
        }}
        className="h-9 w-full rounded-lg bg-[var(--surface-2)] px-3 text-[14px] tabular-nums text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      />
    </label>
  );
}
