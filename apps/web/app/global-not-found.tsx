import "@/src/site-astryx.css";
import "@/src/themes/mesh/mesh.css";
import "./(site)/site.css";
import type { Metadata } from "next";
import { NotFoundBody } from "@/components/site/not-found-body";
import { SiteThemeSync } from "@/components/site/site-theme";
import { getLocale } from "@/lib/locale";
import { SITE_COPY } from "@/lib/site/copy";

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
        <NotFoundBody copy={copy} />
      </body>
    </html>
  );
}
