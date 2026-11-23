"use client";

import { TopNavMenu } from "@astryxdesign/core/TopNav";
import { type ReactNode, useEffect, useState } from "react";

export function SiteHeaderScroll({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className="site-header" data-scrolled={scrolled ? "true" : "false"}>
      {children}
    </header>
  );
}

export function SiteAgentsMenu({
  label,
  items,
}: {
  label: string;
  items: { title: string; description: string; href: string }[];
}) {
  return <TopNavMenu label={label} delay={0} items={items} />;
}
