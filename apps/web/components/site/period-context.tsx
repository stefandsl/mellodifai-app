"use client";

import { VStack } from "@astryxdesign/core/VStack";
import { createContext, type ReactNode, use, useState } from "react";
import { PERIODS, type Period } from "@/lib/site/plans";
import { SiteText } from "@/src/site-primitives";

type PeriodState = {
  period: Period;
  changed: boolean;
  setPeriod: (next: Period) => void;
};

const PeriodContext = createContext<PeriodState>({
  period: "monthly",
  changed: false,
  setPeriod: () => {},
});

export function usePeriod() {
  return use(PeriodContext);
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriodState] = useState<Period>("monthly");
  const [changed, setChanged] = useState(false);
  const setPeriod = (next: Period) => {
    setPeriodState(next);
    setChanged(true);
  };
  return (
    <PeriodContext value={{ period, changed, setPeriod }}>
      {children}
    </PeriodContext>
  );
}

export function PlanUnits({
  units,
  stacked = true,
}: {
  units: Record<Period, string>;
  stacked?: boolean;
}) {
  const { period, changed } = use(PeriodContext);
  if (!stacked) {
    return (
      <SiteText
        type="supporting"
        color="secondary"
        data-plan-unit-monthly={units.monthly}
        data-plan-unit-yearly={units.yearly}
      >
        {units[period]}
      </SiteText>
    );
  }
  return (
    <VStack className="site-plan-card__units" data-animate={changed}>
      {PERIODS.map((p) => (
        <SiteText
          key={p}
          type="supporting"
          color="secondary"
          className="site-plan-card__unit"
          data-period={p}
          data-shown={p === period}
          aria-hidden={p !== period}
        >
          {units[p]}
        </SiteText>
      ))}
    </VStack>
  );
}
