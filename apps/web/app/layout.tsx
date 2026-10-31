import { t } from "@mellodifai/shared";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/components/locale-provider";
import { THEME_SCRIPT } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getLocale } from "@/lib/locale";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono-face",
});

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
    <html
      lang={lang}
      className={`dark h-full antialiased ${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant theme bootstrap, no user input. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <LocaleProvider value={lang}>
          {children}
          <Toaster position="bottom-center" />
        </LocaleProvider>
      </body>
    </html>
  );
}
