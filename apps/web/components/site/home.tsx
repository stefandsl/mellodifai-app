import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { AGENTS, agentHref, href } from "@/lib/site/nav";
import {
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";
import { Cover, type CoverKind, Rule } from "./art";
import { FeatureReel } from "./feature-reel";
import { HeroComposer } from "./hero-composer";
import { KindsStage } from "./home-client";
import { CheckGlyph } from "./icons";
import { PeriodProvider, PlanUnits } from "./period-context";
import { PeriodSwitch } from "./period-switch";
import {
  ClosingBand,
  ShowcaseSection,
  StepCard,
  StudioPicture,
} from "./shared-sections";

const AGENT_TITLES = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  codex: "Codex",
  cursor: "Cursor",
} as const;
const HERO_CARDS: CoverKind[] = [
  "remix",
  "cover",
  "pantomime",
  "satire",
  "karaoke",
];

// The home page. Each block carries `data-ref-section` with the index of the reference section
// it stands for (STUDY.md, Home, sections 0 to 12), so the likeness judge can measure it.
export function Home({ copy }: { copy: SiteCopy }) {
  const h = copy.hero;
  return (
    <>
      {/* 0. Hero: rotating title, composer, chip row, agent links, 5 tilted covers, ruler strip */}
      <VStack
        as="section"
        className="site-hero"
        data-ref-section="0"
        aria-labelledby="hero-title"
      >
        <VStack className="site-mesh site-mesh--sky" aria-hidden="true" />
        <VStack className="site-mesh site-mesh--stage" aria-hidden="true" />
        <VStack className="site-hero__cards" aria-hidden="true">
          {HERO_CARDS.map((kind, i) => (
            <VStack
              key={kind}
              className={`site-hero__card site-hero__card--${i}`}
            >
              <Cover kind={kind} className="site-hero__card-cover" />
            </VStack>
          ))}
        </VStack>
        <VStack className="site-hero__copy" hAlign="center">
          <SiteHeading
            level={1}
            id="hero-title"
            type="display-1"
            justify="center"
            className="site-hero__title"
          >
            <SiteText className="site-sr-only" color="inherit">
              {h.fixedTitle}
            </SiteText>
            <SiteText
              className="site-hero__rotator"
              color="inherit"
              aria-hidden="true"
              data-hero-rotator="true"
              data-rotator-index="0"
            >
              {h.rotatorLines.map((line, i) => (
                <SiteText
                  key={`${line.a}-${line.b}`}
                  className="site-hero__rotator-line"
                  color="inherit"
                  data-rotator-line={String(i)}
                  data-active={i === 0 ? "true" : "false"}
                >
                  <SiteText className="site-hero__title-line" color="inherit">
                    {line.a}
                  </SiteText>{" "}
                  <SiteText className="site-hero__title-line" color="inherit">
                    {line.b}{" "}
                    {line.accent ? (
                      <em className="site-accent">{line.accent}</em>
                    ) : null}
                    {line.end ?? ""}
                  </SiteText>
                </SiteText>
              ))}
            </SiteText>
          </SiteHeading>
          <SiteText
            as="p"
            type="large"
            color="secondary"
            justify="center"
            className="site-hero__lede"
          >
            {h.lede}
          </SiteText>
        </VStack>
        <VStack className="site-hero__stage">
          <HeroComposer copy={h} />
          <HStack
            className="site-hero__links"
            gap={2}
            align="center"
            wrap="wrap"
            justify="center"
            id="agents"
          >
            <SiteText type="supporting" color="secondary">
              {h.agentsLabel}
            </SiteText>
            {AGENTS.map((a) => (
              <SiteLink
                key={a}
                href={agentHref(a)}
                color="inherit"
                className="site-pill"
              >
                {AGENT_TITLES[a]}
              </SiteLink>
            ))}
          </HStack>
          <VStack className="site-hero__rule" aria-hidden="true">
            <Rule />
          </VStack>
        </VStack>
      </VStack>

      {/* 1. Showcase: title, two moving rows of song cards, the main action */}
      <ShowcaseSection
        copy={copy.showcase}
        sectionIndex={1}
        titleId="show-title"
      />

      {/* 2. Three steps: title, three step cards */}
      <VStack
        as="section"
        id="steps"
        className="site-steps site-block"
        data-ref-section="2"
        aria-labelledby="steps-title"
      >
        <SiteHeading
          level={2}
          id="steps-title"
          className="site-title site-steps__title"
        >
          {copy.steps.title}
        </SiteHeading>
        <HStack
          className="site-steps__grid"
          data-ref-grid
          data-ref-grid-widths="1440,1024"
          role="list"
        >
          {copy.steps.items.map((step, i) => (
            <StepCard
              key={step.title}
              index={i}
              title={step.title}
              line={step.line}
            />
          ))}
        </HStack>
      </VStack>

      {/* 3. Feature list: title block */}
      <VStack
        id="features"
        className="site-block site-features__head"
        data-ref-section="3"
        gap={3}
      >
        <SiteHeading level={2} className="site-title">
          {copy.features.title}
        </SiteHeading>
        <SiteText as="p" type="large" color="secondary">
          {copy.features.line}
        </SiteText>
      </VStack>

      {/* 4-6. Features: number, title, self-advancing points, and 3-panel carousel */}
      {copy.features.items.map((f, i) => (
        <FeatureReel key={f.label} copy={copy} index={i} />
      ))}

      {/* 7. Platform panel: title, link, a picture of the studio, three notes */}
      <VStack
        as="section"
        id="studio"
        className="site-platform"
        data-ref-section="7"
        aria-labelledby="platform-title"
      >
        <VStack className="site-platform__panel" data-ref-content gap={10}>
          <HStack
            className="site-platform__head"
            justify="between"
            align="end"
            wrap="wrap"
            gap={4}
          >
            <SiteHeading level={2} id="platform-title" className="site-title">
              {copy.platform.title}
            </SiteHeading>
            <SiteLink href={href("desktop")} className="site-link">
              {copy.platform.link}
            </SiteLink>
          </HStack>
          <HStack
            className="site-platform__grid"
            data-ref-grid
            data-ref-grid-widths="1440,1024"
          >
            <VStack
              as="figure"
              className="site-platform__shot"
              aria-label={copy.platform.shot}
            >
              <StudioPicture copy={copy} />
            </VStack>
            <VStack as="ul" className="site-platform__notes" gap={6}>
              {copy.platform.notes.map((n) => (
                <VStack as="li" key={n.title} gap={1}>
                  <SiteText weight="medium">{n.title}</SiteText>
                  <SiteText type="supporting" color="secondary">
                    {n.line}
                  </SiteText>
                </VStack>
              ))}
            </VStack>
          </HStack>
        </VStack>
      </VStack>

      {/* 8. Category stage: seven recipe kinds and a stage */}
      <VStack
        as="section"
        id="kinds"
        className="site-kinds"
        data-ref-section="8"
        aria-labelledby="kinds-title"
        gap={10}
      >
        <VStack gap={3}>
          <SiteHeading level={2} id="kinds-title" className="site-title">
            {copy.kinds.title}
          </SiteHeading>
          <SiteText as="p" type="large" color="secondary">
            {copy.kinds.line}
          </SiteText>
        </VStack>
        <KindsStage copy={copy.kinds} />
      </VStack>

      {/* 9. Plans */}
      <VStack
        as="section"
        id="plans"
        className="site-plans"
        data-ref-section="9"
        aria-labelledby="plans-title"
        gap={8}
      >
        <SiteHeading
          level={2}
          id="plans-title"
          justify="center"
          className="site-title"
        >
          {copy.plans.title}
        </SiteHeading>
        <HomePlans copy={copy.plans} />
      </VStack>

      {/* 10. FAQ: title left, five questions right */}
      <HStack
        as="section"
        id="faq"
        className="site-faq"
        data-ref-section="10"
        data-ref-grid
        aria-labelledby="faq-title"
      >
        <SiteHeading
          level={2}
          id="faq-title"
          className="site-title site-faq__title"
        >
          {copy.faq.title}
        </SiteHeading>
        <VStack className="site-faq__list">
          {copy.faq.items.map((item) => (
            <Collapsible
              key={item.q}
              defaultIsOpen={false}
              className="site-faq__item"
              trigger={
                <SiteText weight="medium" className="site-faq__q">
                  {item.q}
                </SiteText>
              }
            >
              <SiteText as="p" color="secondary" className="site-faq__a">
                {item.a}
              </SiteText>
            </Collapsible>
          ))}
        </VStack>
      </HStack>

      {/* 11. Closing band: covers around a centred title and the main action */}
      <ClosingBand
        sectionIndex={11}
        titleId="close-title"
        title={copy.closing.title}
        actionLabel={copy.closing.action}
        actionHref={href("start")}
        note={copy.closing.note}
      />
    </>
  );
}

function HomePlans({ copy }: { copy: SiteCopy["plans"] }) {
  return (
    <PeriodProvider>
      <VStack className="site-plans__body" gap={8} hAlign="center">
        <PeriodSwitch
          label={copy.switchLabel}
          options={[
            { value: "monthly", label: copy.monthly },
            { value: "yearly", label: copy.yearly },
          ]}
        />
        <HStack
          className="site-plans__grid"
          data-ref-grid
          data-ref-grid-widths="1440,1024"
        >
          {copy.items.map((plan, i) => (
            <Card
              key={plan.name}
              className={`site-plan ${i === 2 ? "site-plan--chosen" : ""}`}
              padding={6}
            >
              <VStack gap={4}>
                <HStack justify="between" align="center" gap={2} wrap="wrap">
                  <SiteHeading level={3} className="site-plan__name">
                    {plan.name}
                  </SiteHeading>
                  {i === 2 ? (
                    <SiteText type="code" className="site-tag site-tag--accent">
                      {copy.recommended}
                    </SiteText>
                  ) : null}
                </HStack>
                <VStack gap={1}>
                  <SiteText className="site-plan__price">{copy.price}</SiteText>
                  <PlanUnits units={copy.period} stacked={false} />
                </VStack>
                <SiteText as="p" color="secondary">
                  {plan.line}
                </SiteText>
                <SiteButtonLink
                  label={plan.action}
                  href={href("start")}
                  variant={i === 2 ? "primary" : "secondary"}
                  width="100%"
                />
                <VStack as="ul" gap={2} className="site-plan__list">
                  {plan.items.map((item) => (
                    <HStack as="li" key={item} gap={2} align="start">
                      <SiteIcon icon={CheckGlyph} size="sm" color="secondary" />
                      <SiteText type="supporting">{item}</SiteText>
                    </HStack>
                  ))}
                </VStack>
              </VStack>
            </Card>
          ))}
        </HStack>
        <SiteLink href={href("plans")} className="site-link">
          {copy.compare}
        </SiteLink>
      </VStack>
    </PeriodProvider>
  );
}
