import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { FOOTER_COLUMNS, href } from "@/lib/site/nav";
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
            <Text as="p" className="site-footer__tagline">
              {copy.footer.tagline}
            </Text>
          </VStack>
          <HStack
            as="nav"
            aria-label={copy.footer.label}
            className="site-footer__links"
          >
            {FOOTER_COLUMNS.map((col) => (
              <VStack key={col.head} gap={3} className="site-footer__column">
                <Heading level={2} className="site-footer__head">
                  {copy.footer.heads[col.head]}
                </Heading>
                <VStack as="ul" gap={2} className="site-footer__list">
                  {col.links.map((name) => (
                    <VStack as="li" key={name}>
                      <Link
                        href={href(name)}
                        color="secondary"
                        className="site-footer__link"
                      >
                        {copy.nav[name]}
                      </Link>
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
          <Text type="supporting" color="secondary">
            {copy.footer.copyright}
          </Text>
          <Text type="supporting" color="secondary">
            {copy.footer.signoff}
          </Text>
        </HStack>
      </VStack>
    </VStack>
  );
}
