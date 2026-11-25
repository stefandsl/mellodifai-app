import { t } from "@mellodifai/shared";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { LocaleProvider } from "@/components/locale-provider";
import { Toaster } from "@/components/ui/sonner";
import { getLocale } from "@/lib/locale";
import { GLASS_SCRIPT } from "@/lib/studio/ambient";
import { THEME_SCRIPT } from "@/lib/theme";

// The studio faces are not preloaded: a preload here is on every route, and the public site
// (app/(site)) never draws them. The studio gets them from its stylesheet with a matched fallback.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  preload: false,
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono-face",
  preload: false,
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
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed local bootstrap strings, no user input.
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + GLASS_SCRIPT }}
        />
      </head>
      {/* Browser extensions (e.g. Video Speed Controller) add classes to <body> before hydration. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <LocaleProvider value={lang}>
          {children}
          <Toaster position="bottom-center" />
        </LocaleProvider>
      </body>
    </html>
  );
}
