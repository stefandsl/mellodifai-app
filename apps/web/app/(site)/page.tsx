import type { Metadata } from "next";
import { preload } from "react-dom";
import { Home } from "@/components/site/home";
import { getLocale } from "@/lib/locale";
import { SITE_COPY } from "@/lib/site/copy";

const HOME_FONTS = ["/site/fonts/instrument-serif-latin-400-italic.woff2"];

// Visitors get the public home page; a signed-in user goes on to /create (proxy.ts).
export async function generateMetadata(): Promise<Metadata> {
  const copy = SITE_COPY[await getLocale()];
  return { title: copy.meta.title, description: copy.meta.description };
}

export default async function HomePage() {
  for (const font of HOME_FONTS)
    preload(font, {
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous",
      fetchPriority: "low",
    });
  return <Home copy={SITE_COPY[await getLocale()]} />;
}
