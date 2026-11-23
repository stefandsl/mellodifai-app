"use client";

import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import { href } from "@/lib/site/nav";
import { type Period, RECOMMENDED_PLAN } from "@/lib/site/plans";
import { PlanCard } from "./plan-card";
import { Segmented } from "./segmented";

// Reference sections 0 and 1 of the pricing page: the head (title, period switch, one line) and
// the four plan cards. They share the chosen period; the address does not change with it.
export function PricingPlans({ copy }: { copy: SiteCopy }) {
  const [period, setPeriod] = useState<Period>("monthly");
  const [changed, setChanged] = useState(false);
  const plans = copy.plans;
  return (
    <>
      <VStack
        as="section"
        className="site-price-head"
        data-ref-section="0"
        aria-labelledby="pricing-title"
        hAlign="center"
      >
        <Heading
          level={1}
          id="pricing-title"
          justify="center"
          className="site-price-head__title"
        >
          {copy.pricing.title}
        </Heading>
        <Segmented
          label={plans.switchLabel}
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setChanged(true);
          }}
          options={[
            { value: "monthly", label: plans.monthly },
            { value: "yearly", label: plans.yearly },
          ]}
          className="site-price-head__switch"
        />
        <Text as="p" color="secondary" className="site-price-head__line">
          {copy.pricing.line}
        </Text>
      </VStack>
      <VStack
        as="section"
        className="site-price-plans"
        data-ref-section="1"
        aria-label={plans.title}
      >
        <VStack
          className="site-price-plans__grid"
          data-ref-grid
          data-ref-grid-widths="1440,1024"
        >
          {plans.items.map((plan, i) => (
            <PlanCard
              key={plan.name}
              name={plan.name}
              line={plan.line}
              items={plan.items}
              action={plan.action}
              href={href("start")}
              price={plans.price}
              units={plans.period}
              period={period}
              recommended={
                i === RECOMMENDED_PLAN ? plans.recommended : undefined
              }
              headingLevel={2}
              animate={changed}
            />
          ))}
        </VStack>
      </VStack>
    </>
  );
}
