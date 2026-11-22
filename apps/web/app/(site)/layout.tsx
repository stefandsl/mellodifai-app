import "@astryxdesign/core/astryx.css";
import "./site.css";
import { Link } from "@astryxdesign/core/Link";
import { VStack } from "@astryxdesign/core/VStack";
import { preload } from "react-dom";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteTheme } from "@/components/site/site-theme";
import { getLocale } from "@/lib/locale";
import { SITE_COPY } from "@/lib/site/copy";

// The two faces of the first screen load first; the fallback faces in site.css have their
// width and height, so the page does not move when they arrive.
const FIRST_FONTS = [
  "/site/fonts/instrument-serif-latin-400-normal.woff2",
  "/site/fonts/figtree-latin-400-normal.woff2",
];

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  for (const font of FIRST_FONTS)
    preload(font, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  const copy = SITE_COPY[await getLocale()];
  return (
    <SiteTheme>
      <VStack className="site">
        <Link href="#main" className="site-skip" color="inherit">
          {copy.skip}
        </Link>
        <SiteHeader copy={copy} />
        <VStack as="main" id="main" className="site-main" tabIndex={-1}>
          {children}
        </VStack>
        <SiteFooter copy={copy} />
      </VStack>
    </SiteTheme>
  );
}
