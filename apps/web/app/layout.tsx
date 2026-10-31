import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mellodifai",
  description: "La tua musica, dal testo al video.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
