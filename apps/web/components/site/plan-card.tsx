import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { PERIODS, type Period } from "@/lib/site/plans";
import { CheckGlyph } from "./icons";

export type PlanCardProps = {
  name: string;
  line: string;
  items: readonly string[];
  action: string;
  href: string;
  price: string;
  /** The unit under the price for each billing period ("per month"). */
  units: Record<Period, string>;
  period: Period;
  recommended?: string;
  /** 2 when the card titles sit right under the page title, 3 under a section title. */
  headingLevel?: 2 | 3;
  /** The unit fades in when the period changes, not at load. */
  animate?: boolean;
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
  period,
  recommended,
  headingLevel = 3,
  animate = false,
}: PlanCardProps) {
  return (
    <Card
      className={`site-plan site-plan-card ${recommended ? "site-plan--chosen" : ""}`}
      padding={6}
    >
      <VStack gap={6} className="site-plan-card__body">
        <HStack justify="between" align="center" gap={2} wrap="wrap">
          <Heading level={headingLevel} className="site-plan__name">
            {name}
          </Heading>
          {recommended ? (
            <Text type="code" className="site-tag site-tag--accent">
              {recommended}
            </Text>
          ) : null}
        </HStack>
        <VStack gap={1}>
          <Text className="site-plan__price site-plan-card__price">
            {price}
          </Text>
          <VStack className="site-plan-card__units" data-animate={animate}>
            {PERIODS.map((p) => (
              <Text
                key={p}
                type="supporting"
                color="secondary"
                className="site-plan-card__unit"
                data-shown={p === period}
                aria-hidden={p !== period}
              >
                {units[p]}
              </Text>
            ))}
          </VStack>
        </VStack>
        <Text as="p" color="secondary">
          {line}
        </Text>
        <Button
          label={action}
          href={href}
          variant={recommended ? "primary" : "secondary"}
          width="100%"
        />
        <VStack as="ul" gap={3} className="site-plan__list">
          {items.map((item) => (
            <HStack as="li" key={item} gap={2} align="start">
              <Icon icon={CheckGlyph} size="sm" color="secondary" />
              <Text type="supporting">{item}</Text>
            </HStack>
          ))}
        </VStack>
      </VStack>
    </Card>
  );
}
