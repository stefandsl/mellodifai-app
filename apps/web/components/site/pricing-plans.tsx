import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { href } from "@/lib/site/nav";
import { RECOMMENDED_PLAN } from "@/lib/site/plans";
import { SiteHeading, SiteText } from "@/src/site-primitives";
import { PeriodProvider } from "./period-context";
import { PeriodSwitch } from "./period-switch";
import { PlanCard } from "./plan-card";

// Reference sections 0 and 1 of the pricing page: the head (title, period switch, one line) and
// the four plan cards. They share the chosen period; the address does not change with it.
export function PricingPlans({ copy }: { copy: SiteCopy }) {
  const plans = copy.plans;
  return (
    <PeriodProvider>
      <VStack
        as="section"
        className="site-price-head"
        data-ref-section="0"
        aria-labelledby="pricing-title"
        hAlign="center"
      >
        <SiteHeading
          level={1}
          id="pricing-title"
          justify="center"
          className="site-price-head__title"
        >
          {copy.pricing.title}
        </SiteHeading>
        <PeriodSwitch
          label={plans.switchLabel}
          options={[
            { value: "monthly", label: plans.monthly },
            { value: "yearly", label: plans.yearly },
          ]}
          className="site-price-head__switch"
        />
        <SiteText as="p" color="secondary" className="site-price-head__line">
          {copy.pricing.line}
        </SiteText>
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
              recommended={
                i === RECOMMENDED_PLAN ? plans.recommended : undefined
              }
              headingLevel={2}
            />
          ))}
        </VStack>
      </VStack>
    </PeriodProvider>
  );
}
