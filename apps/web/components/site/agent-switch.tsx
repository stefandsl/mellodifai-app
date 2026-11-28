import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { AGENT_DISPLAY_NAMES, AGENTS, type AgentName } from "@/lib/site/agents";
import { SiteLink, SiteText } from "@/src/site-primitives";

// Geometric agent marks drawn by us on a 16-unit grid (no third-party logos or reference SVGs).
export function AgentMark({
  agent,
  className,
}: {
  agent: AgentName;
  className?: string;
}) {
  const cls = className ? `site-agent-mark ${className}` : "site-agent-mark";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cls}
    >
      {agent === "claude" ? (
        <path d="M8 2.2v11.6M2.2 8h11.6M3.9 3.9l8.2 8.2M12.1 3.9l-8.2 8.2" />
      ) : agent === "chatgpt" ? (
        <>
          <circle cx="8" cy="8" r="5" />
          <path d="M5.5 8h5M8 5.5v5" />
        </>
      ) : agent === "gemini" ? (
        <path d="M8 2.2 9.6 6.4 13.8 8 9.6 9.6 8 13.8 6.4 9.6 2.2 8 6.4 6.4z" />
      ) : agent === "codex" ? (
        <>
          <rect x="2.2" y="3" width="11.6" height="10" rx="2" />
          <path d="M5 6.5 7 8 5 9.5M8.5 9.5h2.5" />
        </>
      ) : (
        <path d="M4 2.8 12.2 7.5 8.5 8.8 7.2 12.5z" />
      )}
    </svg>
  );
}

// Five-way agent switch.
// Server markup renders plain Tab-reachable links with aria-current="page" on the active agent
// (no role="tab" and no tabIndex=-1) so keyboard users can reach every agent without JS.
// The connect variant keeps #how-to-connect so no-JS clicks land on the steps section.
// When the vanilla island initializes (data-enhanced="true"), it promotes the list to an ARIA
// tablist with roving tabIndex, arrow-key navigation, and a sliding thumb.
export function AgentSwitch({
  activeAgent,
  label,
  variant,
  controlsId,
}: {
  activeAgent: AgentName;
  label: string;
  variant: "hero" | "connect";
  controlsId: string;
}) {
  return (
    <VStack
      className="site-agent-switch"
      data-agent-switch={variant}
      data-active-agent={activeAgent}
      data-agent-controls={controlsId}
    >
      <VStack
        className="site-agent-switch__track"
        data-agent-switch-track="true"
      >
        <HStack className="site-agent-switch__shell">
          <VStack
            className="site-agent-switch__thumb"
            aria-hidden="true"
            data-agent-thumb="true"
            data-animating="false"
          />
          <HStack
            aria-label={label}
            className="site-agent-switch__list"
            data-agent-tablist="true"
          >
            {AGENTS.map((id) => {
              const selected = id === activeAgent;
              const tabHref =
                variant === "connect"
                  ? `/agents?agent=${id}#how-to-connect`
                  : `/agents?agent=${id}`;
              return (
                <SiteLink
                  key={id}
                  id={`agent-tab-${variant}-${id}`}
                  aria-current={selected ? "page" : undefined}
                  href={tabHref}
                  color="inherit"
                  className="site-agent-switch__tab"
                  data-agent-tab={id}
                >
                  <HStack
                    align="center"
                    gap={1.5}
                    className="site-agent-switch__tab-inner"
                  >
                    <AgentMark agent={id} />
                    <SiteText color="inherit" weight="medium">
                      {AGENT_DISPLAY_NAMES[id]}
                    </SiteText>
                  </HStack>
                </SiteLink>
              );
            })}
          </HStack>
        </HStack>
      </VStack>
    </VStack>
  );
}
