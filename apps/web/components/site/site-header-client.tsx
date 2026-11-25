"use client";

import { HStack } from "@astryxdesign/core/HStack";
import { TopNavMenu } from "@astryxdesign/core/TopNav";
import { type ReactNode, useEffect, useState } from "react";

export function SiteHeaderScroll({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState<boolean | null>(null);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className="site-header"
      data-scrolled={
        scrolled === null ? undefined : scrolled ? "true" : "false"
      }
    >
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
  return (
    <HStack data-site-agents-menu={JSON.stringify(items)}>
      <TopNavMenu label={label} delay={0} items={items} />
    </HStack>
  );
}
