import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import {
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteText,
} from "@/src/site-primitives";
import { Cover, type CoverKind } from "./art";
import { ArrowGlyph } from "./icons";

export const DEFAULT_CLOSING_ART: readonly CoverKind[] = [
  "remix",
  "cover",
  "satire",
  "translation",
  "karaoke",
  "video",
  "pantomime",
];

export type ClosingBandAction = {
  label: string;
  href: string;
  dataAttr?: string;
};

// Shared closing call-to-action band reused across Home, Recipes and Agents.
export function ClosingBand({
  sectionIndex,
  titleId,
  title,
  primaryAction,
  secondaryAction,
  note,
  covers = DEFAULT_CLOSING_ART,
}: {
  sectionIndex: string;
  titleId: string;
  title: string;
  primaryAction: ClosingBandAction;
  secondaryAction?: ClosingBandAction;
  note: string;
  covers?: readonly CoverKind[];
}) {
  return (
    <VStack
      as="section"
      className="site-close"
      data-ref-section={sectionIndex}
      aria-labelledby={titleId}
    >
      <VStack className="site-close__band">
        <HStack className="site-close__mosaic" aria-hidden="true">
          {covers.map((k) => (
            <Cover key={k} kind={k} className="site-close__cover" />
          ))}
        </HStack>
        <VStack
          className="site-close__column"
          data-ref-content
          gap={8}
          hAlign="center"
        >
          <SiteHeading
            level={2}
            id={titleId}
            type="display-2"
            justify="center"
            className="site-close__title"
          >
            {title}
          </SiteHeading>
          {secondaryAction ? (
            <HStack
              className="site-close__actions"
              gap={2}
              wrap="wrap"
              justify="center"
            >
              <SiteButtonLink
                label={primaryAction.label}
                href={primaryAction.href}
                variant="primary"
                size="lg"
                icon={<SiteIcon icon={ArrowGlyph} size="sm" color="inherit" />}
                data-closing-primary={primaryAction.dataAttr}
              />
              <SiteButtonLink
                label={secondaryAction.label}
                href={secondaryAction.href}
                variant="secondary"
                size="lg"
              />
            </HStack>
          ) : (
            <SiteButtonLink
              label={primaryAction.label}
              href={primaryAction.href}
              variant="primary"
              size="lg"
              icon={<SiteIcon icon={ArrowGlyph} size="sm" color="inherit" />}
            />
          )}
          <SiteText type="supporting" color="secondary" justify="center">
            {note}
          </SiteText>
        </VStack>
      </VStack>
    </VStack>
  );
}
