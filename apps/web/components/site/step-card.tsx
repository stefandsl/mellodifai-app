import { Card } from "@astryxdesign/core/Card";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";
import { SiteHeading, SiteText } from "@/src/site-primitives";

// Shared three-step card reused on Home and Agents ("How to connect").
export function StepCard({
  index,
  title,
  line,
  art,
  footer,
  className,
  headingLevel = 3,
  titleAttr,
  lineAttr,
}: {
  index: number;
  title: string;
  line: string;
  art: ReactNode;
  footer?: ReactNode;
  className?: string;
  headingLevel?: 3 | 4;
  titleAttr?: string;
  lineAttr?: string;
}) {
  return (
    <Card
      className={className ? `site-step ${className}` : "site-step"}
      padding={4}
      role="listitem"
    >
      <VStack gap={4} className="site-step__body">
        <VStack className="site-step__art" aria-hidden="true">
          {art}
        </VStack>
        <VStack gap={1} className="site-step__copy">
          <SiteText type="code" color="secondary" className="site-eyebrow">
            {String(index + 1).padStart(2, "0")}
          </SiteText>
          <SiteHeading
            level={headingLevel}
            className="site-step__title"
            data-step-title={titleAttr}
          >
            {title}
          </SiteHeading>
          <SiteText as="p" color="secondary" data-step-line={lineAttr}>
            {line}
          </SiteText>
        </VStack>
        {footer ?? null}
      </VStack>
    </Card>
  );
}
