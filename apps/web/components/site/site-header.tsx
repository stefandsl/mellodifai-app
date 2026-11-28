import { HStack } from "@astryxdesign/core/HStack";
import type { ReactNode } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import { AGENTS, agentHref, HEADER_LINKS, href } from "@/lib/site/nav";
import {
  SiteButtonLink,
  SiteTopNav,
  SiteTopNavItem,
} from "@/src/site-primitives";
import { Brand } from "./brand";
import { SiteAgentsMenu, SiteHeaderScroll } from "./site-header-client";
import { SiteMenu } from "./site-menu";

const AGENT_TITLES = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  codex: "Codex",
  cursor: "Cursor",
} as const;

export type SiteHeaderPrimaryAction = {
  label: string;
  href: string;
  external?: boolean;
  icon?: ReactNode;
  isDesktopDownload?: boolean;
  platform?: string;
  status?: string;
};

// Fixed header, 73 px. Clear at the top of the page; glass after the page scrolls.
// Wide: logo, five links (the third opens the agents menu on hover or focus), two actions.
// Narrow (under 48em, so a larger text size gets it sooner): logo, main action, menu button.
export function SiteHeader({
  copy,
  primaryAction,
}: {
  copy: SiteCopy;
  primaryAction?: SiteHeaderPrimaryAction;
}) {
  const links = HEADER_LINKS.map((name) =>
    name === "agents" ? (
      <SiteAgentsMenu
        key={name}
        label={copy.agentsMenu}
        items={AGENTS.map((a) => ({
          title: AGENT_TITLES[a],
          description: copy.agentLine[a],
          href: agentHref(a),
        }))}
      />
    ) : (
      <SiteTopNavItem key={name} label={copy.nav[name]} href={href(name)} />
    ),
  );

  const ctaLabel = primaryAction?.label ?? copy.nav.start;
  const ctaHref = primaryAction?.href ?? href("start");

  return (
    <SiteHeaderScroll>
      <SiteTopNav
        label={copy.menu.label}
        className="site-header__bar"
        heading={<Brand label={copy.brandHome} />}
        centerContent={<HStack className="site-nav">{links}</HStack>}
        endContent={
          <HStack gap={2} align="center" className="site-header__actions">
            <SiteButtonLink
              label={copy.nav.signIn}
              href={href("signIn")}
              variant="secondary"
              className="site-header__signin"
            />
            <SiteButtonLink
              label={ctaLabel}
              href={ctaHref}
              rel={primaryAction?.external ? "noopener noreferrer" : undefined}
              icon={primaryAction?.icon}
              variant="secondary"
              className="site-header__cta site-button--inverted"
              data-desktop-download-cta={
                primaryAction?.isDesktopDownload ? "true" : undefined
              }
              data-detected-platform={primaryAction?.platform}
              data-platform-status={primaryAction?.status}
            />
            <SiteMenu copy={copy} primaryAction={primaryAction} />
          </HStack>
        }
      />
    </SiteHeaderScroll>
  );
}
