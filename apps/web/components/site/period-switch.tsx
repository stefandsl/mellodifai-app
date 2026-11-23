"use client";

import type { Period } from "@/lib/site/plans";
import { usePeriod } from "./period-context";
import { Segmented } from "./segmented";

export function PeriodSwitch({
  label,
  options,
  className,
}: {
  label: string;
  options: readonly { value: Period; label: string }[];
  className?: string;
}) {
  const { period, setPeriod } = usePeriod();
  return (
    <Segmented
      label={label}
      value={period}
      onChange={setPeriod}
      options={options}
      className={className}
    />
  );
}

export default PeriodSwitch;
