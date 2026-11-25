import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { FOOTER_COLUMNS, href } from "@/lib/site/nav";
import { SiteHeading, SiteLink, SiteText } from "@/src/site-primitives";
import { Rule } from "./art";

// Footer: the rule strip, tagline, three link columns, the wordmark across the container, the
// legal row, and the floor glow of the mesh. It is reference section 12 of the home page.
export function SiteFooter({ copy }: { copy: SiteCopy }) {
  return (
    <VStack as="footer" className="site-footer" data-ref-footer>
      <Rule />
      <VStack className="site-footer__floor" aria-hidden="true" />
      <VStack className="site-footer__container" data-ref-content>
        <HStack className="site-footer__top" data-ref-grid>
          <VStack className="site-footer__brand" gap={6}>
            <SiteText as="p" className="site-footer__tagline">
              {copy.footer.tagline}
            </SiteText>
          </VStack>
          <HStack
            as="nav"
            aria-label={copy.footer.label}
            className="site-footer__links"
          >
            {FOOTER_COLUMNS.map((col) => (
              <VStack key={col.head} gap={3} className="site-footer__column">
                <SiteHeading level={2} className="site-footer__head">
                  {copy.footer.heads[col.head]}
                </SiteHeading>
                <VStack as="ul" gap={2} className="site-footer__list">
                  {col.links.map((name) => (
                    <VStack as="li" key={name}>
                      <SiteLink
                        href={href(name)}
                        color="secondary"
                        className="site-footer__link"
                      >
                        {copy.nav[name]}
                      </SiteLink>
                    </VStack>
                  ))}
                </VStack>
              </VStack>
            ))}
          </HStack>
        </HStack>
        <svg
          className="site-footer__wordmark"
          viewBox="0 0 1000 240"
          aria-hidden="true"
          focusable="false"
        >
          <text
            x="500"
            y="200"
            textAnchor="middle"
            textLength="992"
            lengthAdjust="spacingAndGlyphs"
          >
            MellodifAI
          </text>
        </svg>
        <HStack
          className="site-footer__bottom"
          justify="between"
          wrap="wrap"
          gap={2}
        >
          <SiteText type="supporting" color="secondary">
            {copy.footer.copyright}
          </SiteText>
          <SiteText type="supporting" color="secondary">
            {copy.footer.signoff}
          </SiteText>
        </HStack>
      </VStack>
    </VStack>
  );
}
