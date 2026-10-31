import { t } from "@mellodifai/shared";
import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { LocaleProvider } from "@/components/locale-provider";
import { getLocale } from "@/lib/locale";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLocale();
  return {
    title: t(lang, "app.name"),
    description: t(lang, "app.description"),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lang = await getLocale();
  return (
    <html lang={lang} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <LocaleProvider value={lang}>
          {children}
          <Toaster />
        </LocaleProvider>
      </body>
    </html>
  );
}
