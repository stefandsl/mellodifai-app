import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import {
  type AgentName,
  getAgentProfile,
  getMcpTools,
  INITIAL_VISIBLE_TOOLS,
  MCP_TOOL_CATEGORIES,
  type McpToolInfo,
} from "@/lib/site/agents";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import {
  SiteButton,
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteText,
} from "@/src/site-primitives";
import { AgentMark, AgentSwitch } from "./agent-switch";
import { ClosingBand } from "./closing-band";
import { ConnectSteps } from "./connect-steps";
import { Faq } from "./faq";
import { SparkGlyph } from "./icons";
import { PromptCloud } from "./prompt-cloud";

function DeviceArt({ index }: { index: number }) {
  return (
    <VStack
      className="site-device-card__art"
      hAlign="center"
      aria-hidden="true"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 240 160"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="site-device-card__svg"
      >
        {index === 0 ? (
          <>
            <rect x="20" y="18" width="200" height="124" rx="12" />
            <path d="M20 44h200" />
            <circle cx="38" cy="31" r="3" />
            <circle cx="50" cy="31" r="3" />
            <circle cx="62" cy="31" r="3" />
            <rect x="36" y="60" width="76" height="64" rx="8" />
            <path d="M128 68h72M128 84h58M128 100h66M128 116h44" />
          </>
        ) : index === 1 ? (
          <>
            <rect x="28" y="20" width="184" height="106" rx="10" />
            <path d="M12 134h216" />
            <path d="M48 48l16 14-16 14M74 76h38" />
            <rect x="48" y="92" width="144" height="18" rx="4" />
          </>
        ) : (
          <>
            <rect x="78" y="14" width="84" height="132" rx="16" />
            <path d="M108 26h24" />
            <rect x="90" y="42" width="60" height="40" rx="6" />
            <path d="M94 98h52M94 112h38" />
            <rect x="94" y="124" width="52" height="12" rx="6" />
          </>
        )}
      </svg>
    </VStack>
  );
}

function ToolCard({
  tool,
  index,
  lang,
  copy,
}: {
  tool: McpToolInfo;
  index: number;
  lang: SiteLang;
  copy: SiteCopy["agents"];
}) {
  const scopeLabel =
    tool.scope === "read"
      ? copy.toolScopeRead
      : tool.scope === "create"
        ? copy.toolScopeCreate
        : copy.toolScopeSpend;
  return (
    <Card
      className="site-tool-card"
      padding={4}
      data-tool-card={tool.name}
      data-tool-category={tool.category}
      data-tool-extra={index >= INITIAL_VISIBLE_TOOLS ? "true" : undefined}
      hidden={index >= INITIAL_VISIBLE_TOOLS}
    >
      <VStack gap={3} className="site-tool-card__body">
        <HStack justify="between" align="center" gap={2} wrap="wrap">
          <code className="site-tool-card__name">{tool.name}</code>
          <SiteText
            type="code"
            className={
              tool.scope === "spend" ? "site-tag site-tag--accent" : "site-tag"
            }
          >
            {scopeLabel}
          </SiteText>
        </HStack>
        <SiteText
          as="p"
          type="supporting"
          color="secondary"
          className="site-tool-card__desc"
          lang={lang === "it" ? "en" : undefined}
        >
          {tool.description}
        </SiteText>
      </VStack>
    </Card>
  );
}

// Agents page (C08): 7 content sections (0..6) plus shared SiteFooter (section 7),
// matching STUDY.md "Plugins page" (mcp-chatgpt / mcp-claude) geometry and flow.
export function AgentsPage({
  agent,
  lang,
  copy,
}: {
  agent: AgentName;
  lang: SiteLang;
  copy: SiteCopy;
}) {
  const a = copy.agents;
  const profile = getAgentProfile(agent, lang);
  const tools = getMcpTools();
  const faqItems = a.faq.map((item, idx) =>
    idx === 0 ? { q: item.q, a: profile.faqClientAnswer } : item,
  );

  return (
    <>
      {/* Visually hidden status region present in server markup for copy and switch announcements */}
      <SiteText
        as="p"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="site-sr-only"
        data-agents-status="true"
      />

      {/* 0. Hero: 5-way agent switch, two-line title with inline mark, lede, 2 buttons, note, chat mock */}
      <VStack
        as="section"
        className="site-agents-hero"
        data-ref-section="0"
        aria-labelledby="agents-hero-title"
      >
        <VStack className="site-mesh site-mesh--sky" aria-hidden="true" />
        <VStack className="site-agents-hero__inner" hAlign="center">
          <AgentSwitch
            activeAgent={agent}
            label={a.switchLabel}
            variant="hero"
            controlsId="agents-hero-panel"
          />

          <VStack
            id="agents-hero-panel"
            role="tabpanel"
            aria-labelledby={`agent-tab-hero-${agent}`}
            className="site-agents-hero__stack"
            data-ref-grid
            hAlign="center"
            data-agents-hero-panel="true"
          >
            <VStack className="site-agents-hero__head" gap={6} hAlign="center">
              <VStack
                gap={4}
                hAlign="center"
                className="site-agents-hero__copy"
              >
                <SiteHeading
                  level={1}
                  id="agents-hero-title"
                  type="display-1"
                  justify="center"
                  className="site-agents-hero__title"
                >
                  <SiteText
                    className="site-agents-hero__line-a"
                    color="inherit"
                    data-hero-line-a="true"
                  >
                    {profile.heroLineA}
                  </SiteText>{" "}
                  <HStack
                    align="center"
                    justify="center"
                    gap={3}
                    className="site-agents-hero__line-b"
                  >
                    <VStack
                      className="site-agents-hero__mark-pill"
                      aria-hidden="true"
                      data-hero-mark-wrap="true"
                    >
                      <AgentMark
                        agent={agent}
                        className="site-agents-hero__mark"
                      />
                    </VStack>
                    <em className="site-accent" data-hero-line-b="true">
                      {profile.heroLineB}
                    </em>
                  </HStack>
                </SiteHeading>
                <SiteText
                  as="p"
                  type="large"
                  color="secondary"
                  justify="center"
                  className="site-agents-hero__lede"
                  data-hero-lede="true"
                >
                  {profile.heroLede}
                </SiteText>
              </VStack>

              <VStack
                gap={4}
                hAlign="center"
                className="site-agents-hero__actions-wrap"
              >
                <HStack
                  gap={2}
                  wrap="wrap"
                  justify="center"
                  className="site-agents-hero__actions"
                >
                  <SiteButtonLink
                    label={profile.primaryCtaLabel}
                    href={profile.primaryCtaHref}
                    variant="secondary"
                    size="lg"
                    className="site-button--inverted"
                    data-hero-primary-cta="true"
                  >
                    <SiteText color="inherit" data-btn-label="true">
                      {profile.primaryCtaLabel}
                    </SiteText>
                  </SiteButtonLink>
                  <SiteButtonLink
                    label={a.secondaryCta}
                    href="#how-to-connect"
                    variant="secondary"
                    size="lg"
                    data-hero-secondary-cta="true"
                  />
                </HStack>
                <SiteText
                  type="supporting"
                  color="secondary"
                  justify="center"
                  className="site-agents-hero__note"
                >
                  {a.heroNote}
                </SiteText>
              </VStack>
            </VStack>

            {/* Chat window mock (our own drawing) */}
            <VStack
              as="figure"
              className="site-agents-mock"
              data-ref-content
              aria-label={a.mockWindowLabel}
            >
              <HStack
                className="site-agents-mock__bar"
                justify="between"
                align="center"
                gap={3}
              >
                <HStack align="center" gap={2}>
                  <SiteIcon icon={SparkGlyph} size="sm" color="primary" />
                  <SiteText weight="medium" data-mock-client="true">
                    {profile.mockChat.clientLabel}
                  </SiteText>
                </HStack>
                <SiteText
                  type="code"
                  color="secondary"
                  className="site-tag"
                  data-mock-badge="true"
                >
                  {profile.transportBadge}
                </SiteText>
              </HStack>
              <VStack className="site-agents-mock__body" gap={4}>
                <VStack className="site-agents-mock__msg site-agents-mock__msg--user">
                  <SiteText as="p" data-mock-prompt="true">
                    {profile.mockChat.userPrompt}
                  </SiteText>
                </VStack>
                <VStack className="site-agents-mock__tool" gap={1}>
                  <HStack justify="between" align="center" gap={2} wrap="wrap">
                    <SiteText
                      type="code"
                      color="secondary"
                      className="site-eyebrow"
                    >
                      {a.mockToolLabel}
                    </SiteText>
                    <code
                      className="site-agents-mock__tool-name"
                      data-mock-tool="true"
                    >
                      {profile.mockChat.toolName}
                    </code>
                  </HStack>
                  <SiteText
                    type="supporting"
                    color="secondary"
                    data-mock-tool-meta="true"
                  >
                    {profile.mockChat.toolMeta}
                  </SiteText>
                </VStack>
                <VStack className="site-agents-mock__msg site-agents-mock__msg--reply">
                  <SiteText as="p" color="secondary" data-mock-reply="true">
                    {profile.mockChat.assistantReply}
                  </SiteText>
                </VStack>
              </VStack>
            </VStack>
          </VStack>
        </VStack>
      </VStack>

      {/* 1. How to connect: title, switch, 3 step cards with copy buttons, button */}
      <ConnectSteps profile={profile} copy={a} />

      {/* 2. What it can do: real MCP tools from TOKEN_OPS, 6 category chips, 4/3/2 column grid, show more */}
      <VStack
        as="section"
        id="tools"
        className="site-agents-tools"
        data-ref-section="2"
        aria-labelledby="tools-title"
        hAlign="center"
      >
        <VStack gap={4} hAlign="center" className="site-agents-tools__head">
          <SiteHeading
            level={2}
            id="tools-title"
            justify="center"
            className="site-title"
          >
            {a.toolsTitle}
          </SiteHeading>
          <SiteText
            as="p"
            type="large"
            color="secondary"
            justify="center"
            className="site-lede"
          >
            {a.toolsLine.replace("{count}", String(tools.length))}
          </SiteText>
        </VStack>

        <HStack
          className="site-agents-tools__filters"
          data-ref-content
          role="group"
          aria-label={a.toolsFilterLabel}
          gap={2}
          wrap="wrap"
          justify="center"
        >
          {MCP_TOOL_CATEGORIES.map((cat) => (
            <SiteButton
              key={cat}
              label={a.toolCategories[cat]}
              variant="secondary"
              size="sm"
              className="site-chip site-agents-tools__chip"
              aria-pressed={cat === "all"}
              data-tool-filter={cat}
            >
              {a.toolCategories[cat]}
            </SiteButton>
          ))}
        </HStack>

        <HStack
          className="site-agents-tools__grid"
          data-ref-grid
          data-tools-grid="true"
          data-tools-expanded="false"
        >
          {tools.map((tool, index) => (
            <ToolCard
              key={tool.name}
              tool={tool}
              index={index}
              lang={lang}
              copy={a}
            />
          ))}
        </HStack>

        <SiteButton
          label={a.toolsShowAll.replace("{count}", String(tools.length))}
          variant="secondary"
          size="md"
          className="site-agents-tools__more"
          aria-expanded={false}
          data-tools-toggle="true"
          data-label-more={a.toolsShowAll.replace(
            "{count}",
            String(tools.length),
          )}
          data-label-less={a.toolsShowLess}
        >
          <SiteText color="inherit" data-btn-label="true">
            {a.toolsShowAll.replace("{count}", String(tools.length))}
          </SiteText>
        </SiteButton>
      </VStack>

      {/* 3. Devices: title, one line, 3 device cards */}
      <VStack
        as="section"
        className="site-agents-devices"
        data-ref-section="3"
        aria-labelledby="devices-title"
      >
        <VStack gap={4} className="site-agents-devices__head">
          <SiteHeading level={2} id="devices-title" className="site-title">
            {a.devicesTitle}
          </SiteHeading>
          <SiteText as="p" type="large" color="secondary" className="site-lede">
            {a.devicesLine}
          </SiteText>
        </VStack>
        <HStack className="site-agents-devices__grid" data-ref-grid role="list">
          {a.devices.map((device, i) => (
            <Card
              key={device.title}
              className="site-device-card"
              padding={5}
              role="listitem"
            >
              <VStack gap={4} className="site-device-card__body">
                <DeviceArt index={i} />
                <VStack gap={1.5}>
                  <SiteText type="code" className="site-tag">
                    {device.tag}
                  </SiteText>
                  <SiteHeading level={3} className="site-device-card__title">
                    {device.title}
                  </SiteHeading>
                  <SiteText as="p" color="secondary">
                    {device.line}
                  </SiteText>
                </VStack>
              </VStack>
            </Card>
          ))}
        </HStack>
      </VStack>

      {/* 4. Prompt cloud: title, floating example prompts around a composer bar */}
      <PromptCloud copy={a} />

      {/* 5. Closing band (reused shared component, 2 buttons) */}
      <ClosingBand
        sectionIndex="5"
        titleId="agents-close-title"
        title={a.closingTitle}
        primaryAction={{
          label: a.closingPrimary,
          href: profile.primaryCtaHref,
          dataAttr: "agents",
        }}
        secondaryAction={{
          label: a.closingSecondary,
          href: "#how-to-connect",
        }}
        note={a.closingNote}
      />

      {/* 6. FAQ (reused shared component, 8 questions, first open at load) */}
      <HStack
        as="section"
        id="faq"
        className="site-faq"
        data-ref-section="6"
        data-ref-grid
        aria-labelledby="agents-faq-title"
      >
        <SiteHeading
          level={2}
          id="agents-faq-title"
          className="site-title site-faq__title"
        >
          {a.faqTitle}
        </SiteHeading>
        <Faq items={faqItems} />
      </HStack>
    </>
  );
}
