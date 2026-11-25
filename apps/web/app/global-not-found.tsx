import "@/src/site-astryx.css";
import "@/src/themes/mesh/mesh.css";
import "./(site)/site.css";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { Metadata } from "next";
import { Brand } from "@/components/site/brand";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteThemeSync } from "@/components/site/site-theme";
import { getLocale } from "@/lib/locale";
import { SITE_COPY } from "@/lib/site/copy";
import {
  SiteButtonLink,
  SiteHeading,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";

export async function generateMetadata(): Promise<Metadata> {
  const copy = SITE_COPY[await getLocale()];
  return {
    title: copy.notFound.meta.title,
    description: copy.notFound.meta.description,
  };
}

export default async function GlobalNotFound() {
  const lang = await getLocale();
  const copy = SITE_COPY[lang];
  return (
    <html
      lang={lang}
      data-theme="dark"
      data-astryx-theme="mesh"
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <SiteThemeSync />
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
      </body>
    </html>
  );
}
