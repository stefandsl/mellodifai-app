import "@/src/site-astryx.css";
import "@/src/themes/mesh/mesh.css";
import "./site.css";
import { VStack } from "@astryxdesign/core/VStack";
import type { Metadata } from "next";
import { preload } from "react-dom";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteThemeSync } from "@/components/site/site-theme";
import { getLocale } from "@/lib/locale";
import { SITE_COPY } from "@/lib/site/copy";
import { SiteLink } from "@/src/site-primitives";

// The two primary faces load first; the secondary faces are preloaded at low fetch priority so
// they never starve render-blocking CSS on HTTP/1.1 yet are not discovered late after layout.
const FIRST_FONTS = [
  "/site/fonts/instrument-serif-latin-400-normal.woff2",
  "/site/fonts/figtree-latin-400-normal.woff2",
];
const SECONDARY_FONTS = [
  "/site/fonts/figtree-latin-500-normal.woff2",
  "/site/fonts/figtree-latin-600-normal.woff2",
  "/site/fonts/ibm-plex-mono-latin-500-normal.woff2",
];

export async function generateMetadata(): Promise<Metadata> {
  const copy = SITE_COPY[await getLocale()];
  return { title: copy.meta.title, description: copy.meta.description };
}

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  for (const font of FIRST_FONTS)
    preload(font, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  for (const font of SECONDARY_FONTS)
    preload(font, {
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous",
      fetchPriority: "low",
    });
  const lang = await getLocale();
  const copy = SITE_COPY[lang];
  return (
    <html
      lang={lang}
      data-theme="dark"
      data-astryx-theme="mesh"
      suppressHydrationWarning
    >
      {/* Browser extensions (e.g. Video Speed Controller) add classes to <body> before hydration. */}
      <body suppressHydrationWarning>
        <SiteThemeSync />
        <VStack className="site">
          <SiteLink href="#main" className="site-skip" color="inherit">
            {copy.skip}
          </SiteLink>
          <SiteHeader copy={copy} />
          <VStack as="main" id="main" className="site-main" tabIndex={-1}>
            {children}
          </VStack>
          <SiteFooter copy={copy} />
        </VStack>
      </body>
    </html>
  );
}
