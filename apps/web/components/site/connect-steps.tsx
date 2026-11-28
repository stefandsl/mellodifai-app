import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { type AgentProfile, REPO_AGENTS_DOCS_URL } from "@/lib/site/agents";
import type { SiteCopy } from "@/lib/site/copy";
import {
  SiteButton,
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";
import { AgentSwitch } from "./agent-switch";
import { ArrowGlyph, CopyGlyph, TerminalGlyph } from "./icons";
import { StepCard } from "./step-card";

function StepVisual({
  index,
  agentName,
}: {
  index: number;
  agentName: string;
}) {
  return (
    <VStack className="site-connect-art" gap={2} hAlign="center">
      <HStack className="site-connect-art__bar" align="center" gap={2}>
        <SiteIcon icon={TerminalGlyph} size="sm" color="secondary" />
        <SiteText
          type="code"
          color="secondary"
          className="site-connect-art__label"
          data-connect-art-agent={index === 0 ? "true" : undefined}
        >
          {index === 0
            ? `${agentName} -> /api/mcp`
            : index === 1
              ? "PAT stdin -> mellodifai login"
              : "tools/list -> 38"}
        </SiteText>
      </HStack>
      <HStack className="site-connect-art__dots" gap={1.5}>
        <VStack className="site-connect-art__pill site-connect-art__pill--on" />
        <VStack
          className={
            index >= 1
              ? "site-connect-art__pill site-connect-art__pill--on"
              : "site-connect-art__pill"
          }
        />
        <VStack
          className={
            index >= 2
              ? "site-connect-art__pill site-connect-art__pill--on"
              : "site-connect-art__pill"
          }
        />
      </HStack>
    </VStack>
  );
}

// Section 1: How to connect (#how-to-connect). Reuses shared StepCard and AgentSwitch.
export function ConnectSteps({
  profile,
  copy,
}: {
  profile: AgentProfile;
  copy: SiteCopy["agents"];
}) {
  return (
    <VStack
      as="section"
      id="how-to-connect"
      className="site-agents-connect"
      data-ref-section="1"
      aria-labelledby="connect-title"
    >
      <VStack className="site-agents-connect__head" gap={6} hAlign="center">
        <SiteHeading
          level={2}
          id="connect-title"
          justify="center"
          className="site-title site-agents-connect__title"
        >
          {copy.connectTitle}
        </SiteHeading>
        <AgentSwitch
          activeAgent={profile.id}
          label={copy.switchLabel}
          variant="connect"
          controlsId="agents-steps-panel"
        />
      </VStack>

      <VStack
        id="agents-steps-panel"
        className="site-agents-connect__body"
        gap={10}
        hAlign="center"
        data-agents-steps-panel="true"
      >
        <HStack className="site-agents-connect__grid" data-ref-grid role="list">
          {profile.connectSteps.map((step, i) => {
            const hasCopy = Boolean(step.copyText);
            const hasBadge = Boolean(step.statusBadge);
            const hasDoc = Boolean(step.docHref);
            return (
              <StepCard
                key={step.title}
                index={i}
                title={step.title}
                line={step.line}
                className="site-connect-step"
                titleAttr={String(i)}
                lineAttr={String(i)}
                art={<StepVisual index={i} agentName={profile.name} />}
                footer={
                  <VStack className="site-connect-step__footer" gap={2}>
                    <SiteText
                      type="code"
                      className="site-tag site-tag--accent site-connect-step__badge"
                      data-step-badge={String(i)}
                      hidden={!hasBadge}
                    >
                      {step.statusBadge ?? ""}
                    </SiteText>
                    <SiteLink
                      href={step.docHref ?? REPO_AGENTS_DOCS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="site-link site-connect-step__doc"
                      data-step-doc={String(i)}
                      hidden={!hasDoc}
                    >
                      {step.docLabel ?? ""}
                    </SiteLink>
                    <VStack
                      className="site-copy-box"
                      gap={2}
                      data-step-copy-box={String(i)}
                      hidden={!hasCopy}
                    >
                      <VStack className="site-copy-box__code-wrap">
                        <code
                          className="site-copy-box__code"
                          data-step-copy-code={String(i)}
                        >
                          {step.copyText ?? ""}
                        </code>
                      </VStack>
                      <SiteButton
                        label={step.copyLabel ?? copy.copyButton}
                        variant="secondary"
                        size="sm"
                        className="site-copy-box__btn"
                        icon={
                          <SiteIcon
                            icon={CopyGlyph}
                            size="sm"
                            color="inherit"
                          />
                        }
                        data-copy-button="true"
                        data-step-copy-btn={String(i)}
                        data-copy-text={step.copyText ?? ""}
                        data-copy-label={step.copyLabel ?? copy.copyButton}
                        data-copy-kind={step.copyKind ?? "cli"}
                      >
                        <SiteText color="inherit" data-btn-label="true">
                          {copy.copyButton}
                        </SiteText>
                      </SiteButton>
                    </VStack>
                  </VStack>
                }
              />
            );
          })}
        </HStack>

        <SiteButtonLink
          label={profile.connectCtaLabel}
          href={profile.connectCtaHref}
          variant="secondary"
          size="lg"
          className="site-button--inverted site-agents-connect__cta"
          icon={<SiteIcon icon={ArrowGlyph} size="sm" color="inherit" />}
          data-agents-connect-cta="true"
        >
          <SiteText color="inherit" data-btn-label="true">
            {profile.connectCtaLabel}
          </SiteText>
        </SiteButtonLink>
      </VStack>
    </VStack>
  );
}
