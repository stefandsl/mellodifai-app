"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { TopNav, TopNavItem, TopNavMenu } from "@astryxdesign/core/TopNav";
import { useEffect, useState } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import { AGENTS, agentHref, HEADER_LINKS, href } from "@/lib/site/nav";
import { Brand } from "./brand";
import { SiteMenu } from "./site-menu";

const AGENT_TITLES = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  codex: "Codex",
  cursor: "Cursor",
} as const;

// Fixed header, 73 px. Clear at the top of the page; glass after the page scrolls.
// Wide: logo, five links (the third opens the agents menu on hover or focus), two actions.
// Narrow (under 48em, so a larger text size gets it sooner): logo, main action, menu button.
export function SiteHeader({ copy }: { copy: SiteCopy }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = HEADER_LINKS.map((name) =>
    name === "agents" ? (
      <TopNavMenu
        key={name}
        label={copy.agentsMenu}
        delay={0}
        items={AGENTS.map((a) => ({
          title: AGENT_TITLES[a],
          description: copy.agentLine[a],
          href: agentHref(a),
        }))}
      />
    ) : (
      <TopNavItem key={name} label={copy.nav[name]} href={href(name)} />
    ),
  );

  return (
    <header className="site-header" data-scrolled={scrolled ? "true" : "false"}>
      <TopNav
        label={copy.menu.label}
        className="site-header__bar"
        heading={<Brand label={copy.brandHome} />}
        centerContent={<HStack className="site-nav">{links}</HStack>}
        endContent={
          <HStack gap={2} align="center" className="site-header__actions">
            <Button
              label={copy.nav.signIn}
              href={href("signIn")}
              variant="secondary"
              className="site-header__signin"
            />
            <Button
              label={copy.nav.start}
              href={href("start")}
              variant="primary"
              className="site-header__cta"
            />
            <SiteMenu copy={copy} />
          </HStack>
        }
      />
    </header>
  );
}
