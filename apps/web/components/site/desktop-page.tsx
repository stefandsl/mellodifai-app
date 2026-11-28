import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import {
  DEFAULT_DESKTOP_PLATFORM,
  DESKTOP_PLATFORMS,
  resolveDesktopCta,
} from "@/lib/site/downloads";
import { href } from "@/lib/site/nav";
import {
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";
import { Rule, Wave } from "./art";
import { Faq } from "./faq";
import { CheckGlyph, DownloadGlyph, MonitorGlyph } from "./icons";
import { PlatformTable } from "./platform-table";
import {
  ClosingBand,
  ShowcaseSection,
  StepCard,
  StudioPicture,
} from "./shared-sections";

// Desktop app page (C07, STUDY.md "Desktop app page", MAPPING.md 3.5).
// Eleven sections (0..10 including shared SiteFooter) matching desktop/layout-ref.json.
export function DesktopPage({ copy }: { copy: SiteCopy }) {
  const d = copy.desktop;
  const defaultCta = resolveDesktopCta(DEFAULT_DESKTOP_PLATFORM, d);

  const downloadButton = (
    variant: "primary" | "secondary",
    extraClass?: string,
  ) => (
    <SiteButtonLink
      label={defaultCta.label}
      href={defaultCta.href}
      rel={defaultCta.external ? "noopener noreferrer" : undefined}
      variant={variant}
      size="lg"
      icon={<SiteIcon icon={DownloadGlyph} size="sm" color="inherit" />}
      className={
        extraClass
          ? `site-desk-cta ${extraClass}`
          : "site-desk-cta site-button--inverted"
      }
      data-desktop-download-cta="true"
      data-detected-platform={defaultCta.platform}
      data-platform-status={defaultCta.status}
    />
  );

  return (
    <>
      {/* 0. Hero: title, one line, 2 buttons, 2 notes, studio preview, platform pill */}
      <VStack
        as="section"
        className="site-desk-hero"
        data-ref-section="0"
        aria-labelledby="desktop-hero-title"
      >
        <VStack className="site-mesh site-mesh--sky" aria-hidden="true" />
        <VStack className="site-mesh site-mesh--stage" aria-hidden="true" />
        <VStack className="site-desk-hero__inner" gap={10} hAlign="center">
          <VStack className="site-desk-hero__copy" gap={5} hAlign="center">
            <SiteHeading
              level={1}
              id="desktop-hero-title"
              type="display-1"
              justify="center"
              className="site-desk-hero__title"
            >
              {d.hero.title}
            </SiteHeading>
            <SiteText
              as="p"
              type="large"
              color="secondary"
              justify="center"
              className="site-lede"
            >
              {d.hero.line}
            </SiteText>
            <HStack
              className="site-desk-hero__actions"
              gap={3}
              justify="center"
              wrap="wrap"
            >
              {downloadButton("secondary", "site-button--inverted")}
              <SiteButtonLink
                label={d.hero.browserAction}
                href={href("start")}
                variant="secondary"
                size="lg"
              />
            </HStack>
            <VStack gap={2} hAlign="center">
              <HStack
                className="site-desk-hero__notes"
                gap={4}
                justify="center"
                wrap="wrap"
              >
                <SiteText type="supporting" color="secondary">
                  {d.hero.notes[0]}
                </SiteText>
                <SiteText type="supporting" color="secondary">
                  {d.hero.notes[1]}
                </SiteText>
              </HStack>
              <VStack className="site-desk-hero__note-slot">
                <SiteText
                  as="p"
                  type="supporting"
                  color="secondary"
                  justify="center"
                  className="site-desk-hero__platform-note"
                  data-desktop-platform-note="true"
                  aria-live="polite"
                >
                  {defaultCta.note}
                </SiteText>
                {DESKTOP_PLATFORMS.map((id) => (
                  <SiteText
                    key={id}
                    as="p"
                    type="supporting"
                    justify="center"
                    aria-hidden="true"
                    className="site-desk-hero__platform-note site-desk-hero__platform-note--sizer"
                  >
                    {d.heroNote[id]}
                  </SiteText>
                ))}
              </VStack>
              <SiteLink href="#platforms" className="site-link">
                {d.hero.allPlatforms}
              </SiteLink>
            </VStack>
          </VStack>

          <HStack
            className="site-desk-hero__frame"
            data-ref-grid
            data-ref-grid-widths="1440,1024"
          >
            <VStack
              as="figure"
              className="site-desk-hero__shot"
              aria-label={d.hero.shotLabel}
            >
              <StudioPicture copy={copy} />
            </VStack>
            <VStack className="site-desk-hero__side" gap={4} justify="between">
              <VStack gap={2}>
                <HStack gap={2} align="center">
                  <SiteIcon icon={MonitorGlyph} size="sm" color="primary" />
                  <SiteText type="code" className="site-eyebrow">
                    {d.included.cardName}
                  </SiteText>
                </HStack>
                <SiteHeading level={2} className="site-desk-hero__side-title">
                  {d.included.cardPrice}
                </SiteHeading>
                <SiteText type="supporting" color="secondary">
                  {d.included.cardSubtitle}
                </SiteText>
              </VStack>
              <SiteLink
                href="#platforms"
                color="inherit"
                className="site-pill site-desk-hero__pill"
              >
                {d.hero.watchPill}
              </SiteLink>
            </VStack>
          </HStack>
        </VStack>
      </VStack>

      {/* 1. Ruler divider */}
      <VStack
        className="site-desk-rule"
        data-ref-section="1"
        aria-hidden="true"
      >
        <Rule />
      </VStack>

      {/* 2. Included local plan (text left, card right) + honest platform table */}
      <VStack
        as="section"
        className="site-desk-included"
        data-ref-section="2"
        aria-labelledby="desktop-included-title"
        gap={10}
      >
        <HStack
          className="site-desk-included__row"
          data-ref-grid
          data-ref-grid-widths="390"
        >
          <VStack className="site-desk-included__copy" data-ref-content gap={4}>
            <SiteHeading
              level={2}
              id="desktop-included-title"
              className="site-title"
            >
              {d.included.title}
            </SiteHeading>
            <SiteText as="p" type="large" color="secondary">
              {d.included.line}
            </SiteText>
          </VStack>
          <Card className="site-desk-included__card" padding={6}>
            <VStack gap={6}>
              <HStack
                className="site-desk-included__card-head"
                data-ref-grid
                data-ref-grid-widths="1440"
              >
                <VStack gap={1}>
                  <SiteHeading level={3} className="site-plan__name">
                    {d.included.cardName}
                  </SiteHeading>
                  <SiteText className="site-plan__price">
                    {d.included.cardPrice}
                  </SiteText>
                  <SiteText type="supporting" color="secondary">
                    {d.included.cardSubtitle}
                  </SiteText>
                </VStack>
                <VStack justify="start" hAlign="end">
                  {downloadButton("secondary", "site-button--inverted")}
                </VStack>
              </HStack>
              <VStack as="ul" gap={2} className="site-plan__list">
                {d.included.items.map((item) => (
                  <HStack as="li" key={item} gap={2} align="start">
                    <SiteIcon icon={CheckGlyph} size="sm" color="secondary" />
                    <SiteText type="supporting">{item}</SiteText>
                  </HStack>
                ))}
              </VStack>
            </VStack>
          </Card>
        </HStack>

        <PlatformTable copy={d.platforms} id="platforms" />
      </VStack>

      {/* 3. Benefits panel: title + 4 columns */}
      <VStack
        as="section"
        className="site-desk-benefits"
        data-ref-section="3"
        aria-labelledby="desktop-benefits-title"
      >
        <VStack className="site-desk-panel" gap={10}>
          <SiteHeading
            level={2}
            id="desktop-benefits-title"
            className="site-title"
          >
            {d.benefits.title}
          </SiteHeading>
          <HStack className="site-desk-benefits__grid" role="list">
            {d.benefits.items.map((item, i) => (
              <VStack
                key={item.title}
                className="site-desk-benefits__item"
                role="listitem"
                gap={2}
              >
                <SiteText
                  type="code"
                  color="secondary"
                  className="site-eyebrow"
                >
                  {String(i + 1).padStart(2, "0")}
                </SiteText>
                <SiteHeading level={3} className="site-step__title">
                  {item.title}
                </SiteHeading>
                <SiteText as="p" color="secondary">
                  {item.line}
                </SiteText>
              </VStack>
            ))}
          </HStack>
        </VStack>
      </VStack>

      {/* 4. Showcase: reused from home */}
      <ShowcaseSection
        copy={copy.showcase}
        sectionIndex={4}
        titleId="desktop-show-title"
        title={d.showcaseTitle}
        line=""
        className="site-show--desktop"
        action={downloadButton("secondary", "site-button--inverted")}
      />

      {/* 5. Ruler divider */}
      <VStack
        className="site-desk-rule"
        data-ref-section="5"
        aria-hidden="true"
      >
        <Rule />
      </VStack>

      {/* 6. Three steps: title, 3 reused step cards, note row */}
      <VStack
        as="section"
        id="desktop-steps"
        className="site-steps site-steps--desktop site-block"
        data-ref-section="6"
        aria-labelledby="desktop-steps-title"
      >
        <SiteHeading
          level={2}
          id="desktop-steps-title"
          className="site-title site-steps__title"
        >
          {d.steps.title}
        </SiteHeading>
        <HStack
          className="site-steps__grid"
          data-ref-grid
          data-ref-grid-widths="1440,1024"
          role="list"
        >
          {d.steps.items.map((step, i) => (
            <StepCard
              key={step.title}
              index={i}
              title={step.title}
              line={step.line}
            />
          ))}
        </HStack>
        <SiteText
          as="p"
          type="supporting"
          color="secondary"
          className="site-desk-steps__note"
        >
          {d.steps.note}
        </SiteText>
      </VStack>

      {/* 7. Own agents panel: text and picture, then 3 connect steps */}
      <VStack
        as="section"
        className="site-desk-agents"
        data-ref-section="7"
        aria-labelledby="desktop-agents-title"
      >
        <VStack className="site-desk-agents__panel" gap={10}>
          <HStack className="site-desk-agents__top" data-ref-grid>
            <VStack className="site-desk-agents__copy" gap={4}>
              <SiteHeading
                level={2}
                id="desktop-agents-title"
                className="site-title"
              >
                {d.agents.title}
              </SiteHeading>
              <SiteText as="p" type="large" color="secondary">
                {d.agents.line}
              </SiteText>
              <SiteLink href={href("agents")} className="site-link">
                {d.agents.link}
              </SiteLink>
            </VStack>
            <VStack className="site-desk-agents__shot-wrap" data-ref-content>
              <Card className="site-desk-agents__shot" padding={6}>
                <VStack gap={4}>
                  <SiteText
                    type="code"
                    color="secondary"
                    className="site-eyebrow"
                  >
                    {d.agents.shotTitle}
                  </SiteText>
                  <VStack gap={2}>
                    {d.agents.shotLines.map((line) => (
                      <SiteText
                        key={line}
                        type="code"
                        className="site-desk-agents__cmd"
                      >
                        {line}
                      </SiteText>
                    ))}
                  </VStack>
                  <Wave seed={91} phrases={3} take={[0.35, 0.7]} />
                </VStack>
              </Card>
            </VStack>
          </HStack>

          <VStack gap={6} className="site-desk-agents__connect">
            <SiteHeading level={3} className="site-desk-agents__sub">
              {d.agents.connectTitle}
            </SiteHeading>
            <HStack className="site-desk-agents__steps" role="list">
              {d.agents.steps.map((step, i) => (
                <VStack
                  key={step.title}
                  className="site-desk-agents__step"
                  role="listitem"
                  gap={2}
                >
                  <SiteText
                    type="code"
                    color="secondary"
                    className="site-eyebrow"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </SiteText>
                  <SiteHeading level={4} className="site-step__title">
                    {step.title}
                  </SiteHeading>
                  <SiteText as="p" color="secondary">
                    {step.line}
                  </SiteText>
                </VStack>
              ))}
            </HStack>
          </VStack>
        </VStack>
      </VStack>

      {/* 8. Closing band: reused from home */}
      <ClosingBand
        sectionIndex={8}
        titleId="desktop-close-title"
        title={d.closing.title}
        action={downloadButton("primary", "site-desk-cta--brand")}
        notes={d.closing.notes}
        className="site-close--desktop"
      />

      {/* 9. FAQ: title left, 10 questions right */}
      <HStack
        as="section"
        id="faq"
        className="site-faq"
        data-ref-section="9"
        data-ref-grid
        aria-labelledby="desktop-faq-title"
      >
        <SiteHeading
          level={2}
          id="desktop-faq-title"
          className="site-title site-faq__title"
        >
          {d.faqTitle}
        </SiteHeading>
        <Faq items={d.faq} />
      </HStack>
    </>
  );
}
