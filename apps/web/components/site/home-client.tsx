"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import { href } from "@/lib/site/nav";
import { Cover, type CoverKind } from "./art";
import { CheckGlyph } from "./icons";

const KIND_ART: CoverKind[] = [
  "remix",
  "cover",
  "pantomime",
  "satire",
  "translation",
  "karaoke",
  "video",
];

// Reference section 8: a list of seven names beside a stage; the chosen name fills the stage.
export function KindsStage({ copy }: { copy: SiteCopy["kinds"] }) {
  const [active, setActive] = useState(0);
  const kind = copy.items[active];
  return (
    <HStack className="site-kinds__body">
      <VStack role="group" aria-label={copy.label} className="site-kinds__list">
        {copy.items.map((k, i) => (
          <ToggleButton
            key={k.name}
            label={k.name}
            isPressed={i === active}
            onPressedChange={() => setActive(i)}
            className="site-kinds__name"
          >
            <Text color="inherit" className="site-kinds__name-text">
              {k.name}
            </Text>
          </ToggleButton>
        ))}
      </VStack>
      <VStack className="site-kinds__stage" gap={4}>
        <Cover kind={KIND_ART[active]} className="site-kinds__cover" />
        <VStack gap={2} className="site-kinds__caption">
          <Heading level={3} className="site-kinds__title">
            {kind.name}
          </Heading>
          <Text as="p" color="secondary" aria-live="polite">
            {kind.line}
          </Text>
        </VStack>
      </VStack>
    </HStack>
  );
}

// Reference section 9: title, billing switch, four plan cards, compare link. Prices are the
// owner's decision, so every price says it is still to be set.
export function PlansBlock({ copy }: { copy: SiteCopy["plans"] }) {
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  return (
    <VStack className="site-plans__body" gap={8} hAlign="center">
      <SegmentedControl
        label={copy.switchLabel}
        value={period}
        onChange={(v) => setPeriod(v as "monthly" | "yearly")}
      >
        <SegmentedControlItem value="monthly" label={copy.monthly} />
        <SegmentedControlItem value="yearly" label={copy.yearly} />
      </SegmentedControl>
      <HStack
        className="site-plans__grid"
        data-ref-grid
        data-ref-grid-widths="1440,1024"
      >
        {copy.items.map((plan, i) => (
          <Card
            key={plan.name}
            className={`site-plan ${i === 2 ? "site-plan--chosen" : ""}`}
            padding={6}
          >
            <VStack gap={4}>
              <HStack justify="between" align="center" gap={2} wrap="wrap">
                <Heading level={3} className="site-plan__name">
                  {plan.name}
                </Heading>
                {i === 2 ? (
                  <Text type="code" className="site-tag site-tag--accent">
                    {copy.recommended}
                  </Text>
                ) : null}
              </HStack>
              <VStack gap={1}>
                <Text className="site-plan__price">{copy.price}</Text>
                <Text type="supporting" color="secondary">
                  {copy.period[period]}
                </Text>
              </VStack>
              <Text as="p" color="secondary">
                {plan.line}
              </Text>
              <Button
                label={plan.action}
                href={href("start")}
                variant={i === 2 ? "primary" : "secondary"}
                width="100%"
              />
              <VStack as="ul" gap={2} className="site-plan__list">
                {plan.items.map((item) => (
                  <HStack as="li" key={item} gap={2} align="start">
                    <Icon icon={CheckGlyph} size="sm" color="secondary" />
                    <Text type="supporting">{item}</Text>
                  </HStack>
                ))}
              </VStack>
            </VStack>
          </Card>
        ))}
      </HStack>
      <Link href={href("plans")} className="site-link">
        {copy.compare}
      </Link>
    </VStack>
  );
}
