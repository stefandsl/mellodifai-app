import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { Period } from "@/lib/site/plans";
import {
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteText,
} from "@/src/site-primitives";
import { CheckGlyph } from "./icons";
import { PlanUnits } from "./period-context";

export type PlanCardProps = {
  name: string;
  line: string;
  items: readonly string[];
  action: string;
  href: string;
  price: string;
  /** The unit under the price for each billing period ("per month"). */
  units: Record<Period, string>;
  recommended?: string;
  /** 2 when the card titles sit right under the page title, 3 under a section title. */
  headingLevel?: 2 | 3;
};

// One plan: name, price, unit, one line, the main action and what the plan holds.
// The unit of every period is in the card at once, stacked in one cell, and only the chosen one
// is shown: a period change swaps the words without moving or resizing anything.
export function PlanCard({
  name,
  line,
  items,
  action,
  href,
  price,
  units,
  recommended,
  headingLevel = 3,
}: PlanCardProps) {
  return (
    <Card
      className={`site-plan site-plan-card ${recommended ? "site-plan--chosen" : ""}`}
      padding={6}
    >
      <VStack gap={6} className="site-plan-card__body">
        <HStack justify="between" align="center" gap={2} wrap="wrap">
          <SiteHeading level={headingLevel} className="site-plan__name">
            {name}
          </SiteHeading>
          {recommended ? (
            <SiteText type="code" className="site-tag site-tag--accent">
              {recommended}
            </SiteText>
          ) : null}
        </HStack>
        <VStack gap={1}>
          <SiteText className="site-plan__price site-plan-card__price">
            {price}
          </SiteText>
          <PlanUnits units={units} />
        </VStack>
        <SiteText as="p" color="secondary">
          {line}
        </SiteText>
        <SiteButtonLink
          label={action}
          href={href}
          variant={recommended ? "primary" : "secondary"}
          width="100%"
        />
        <VStack as="ul" gap={3} className="site-plan__list">
          {items.map((item) => (
            <HStack as="li" key={item} gap={2} align="start">
              <SiteIcon icon={CheckGlyph} size="sm" color="secondary" />
              <SiteText type="supporting">{item}</SiteText>
            </HStack>
          ))}
        </VStack>
      </VStack>
    </Card>
  );
}
