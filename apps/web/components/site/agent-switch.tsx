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

// Five-way agent switch. Renders plain links with role="tab" so the page works without JS
// from ?agent=<id>, while the vanilla island animates the sliding thumb and updates the URL
// via history.pushState without reload. Scrolls horizontally inside its own track at 390 px.
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
            role="tablist"
            aria-label={label}
            className="site-agent-switch__list"
            data-agent-tablist="true"
          >
            {AGENTS.map((id) => {
              const selected = id === activeAgent;
              return (
                <SiteLink
                  key={id}
                  id={`agent-tab-${variant}-${id}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={controlsId}
                  tabIndex={selected ? 0 : -1}
                  href={`/agents?agent=${id}`}
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
