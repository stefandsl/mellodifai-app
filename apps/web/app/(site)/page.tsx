import type { Metadata } from "next";
import { Home } from "@/components/site/home";
import { getLocale } from "@/lib/locale";
import { SITE_COPY } from "@/lib/site/copy";

// Visitors get the public home page; a signed-in user goes on to /create (proxy.ts).
export async function generateMetadata(): Promise<Metadata> {
  const copy = SITE_COPY[await getLocale()];
  return { title: copy.meta.title, description: copy.meta.description };
}

export default async function HomePage() {
  return <Home copy={SITE_COPY[await getLocale()]} />;
}
