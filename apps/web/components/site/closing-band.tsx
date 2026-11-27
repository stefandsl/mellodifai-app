import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { href } from "@/lib/site/nav";
import {
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteText,
} from "@/src/site-primitives";
import { Cover, type CoverKind } from "./art";
import { ArrowGlyph } from "./icons";

// Reference section 11 of home (and closing section on other site pages):
// repo-owned cover mosaic behind a centred display title, brand CTA, and note.
export function ClosingBand({
  copy,
  art,
  sectionIndex,
  titleId,
}: {
  copy: SiteCopy["closing"];
  art: readonly CoverKind[];
  sectionIndex: string;
  titleId: string;
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
          {art.map((k) => (
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
            {copy.title}
          </SiteHeading>
          <SiteButtonLink
            label={copy.action}
            href={href("start")}
            variant="primary"
            size="lg"
            icon={<SiteIcon icon={ArrowGlyph} size="sm" color="inherit" />}
          />
          <SiteText type="supporting" color="secondary" justify="center">
            {copy.note}
          </SiteText>
        </VStack>
      </VStack>
    </VStack>
  );
}
