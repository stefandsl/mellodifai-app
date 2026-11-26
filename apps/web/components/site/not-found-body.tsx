import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Brand } from "@/components/site/brand";
import { SiteFooter } from "@/components/site/site-footer";
import type { SiteCopy } from "@/lib/site/copy";
import {
  SiteButtonLink,
  SiteHeading,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";

// Shared 404 body rendered by both app/global-not-found.tsx and the prerendered
// static not-found-{en,it}.html pages so their copy and structure cannot drift.
export function NotFoundBody({ copy }: { copy: SiteCopy }) {
  return (
    <VStack className="site">
      <SiteLink href="#main" className="site-skip" color="inherit">
        {copy.skip}
      </SiteLink>
      <HStack as="header" className="site-not-found__bar">
        <Brand label={copy.brandHome} />
      </HStack>
      <VStack
        as="main"
        id="main"
        className="site-main site-not-found"
        tabIndex={-1}
      >
        <VStack className="site-mesh site-mesh--sky" aria-hidden="true" />
        <VStack className="site-not-found__content" gap={5}>
          <SiteText className="site-eyebrow" color="secondary">
            {copy.notFound.code}
          </SiteText>
          <SiteHeading level={1} className="site-title">
            {copy.notFound.title}
          </SiteHeading>
          <SiteText as="p" color="secondary" className="site-lede">
            {copy.notFound.line}
          </SiteText>
          <SiteButtonLink
            href="/"
            label={copy.notFound.home}
            variant="secondary"
            className="site-button--inverted"
          />
        </VStack>
      </VStack>
      <SiteFooter copy={copy} />
    </VStack>
  );
}
