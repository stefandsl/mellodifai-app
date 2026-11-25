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
import { Cover, type CoverKind, Wave } from "./art";
import { HeroStudio } from "./hero-studio";
import { KindsStage } from "./home-client";
import { ArrowGlyph, CheckGlyph } from "./icons";
import { PeriodProvider, PlanUnits } from "./period-context";
import { PeriodSwitch } from "./period-switch";

const AGENT_TITLES = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  codex: "Codex",
  cursor: "Cursor",
} as const;
const SHOW_ART: CoverKind[] = [
  "remix",
  "cover",
  "satire",
  "translation",
  "karaoke",
  "video",
];

// The home page. Each block carries `data-ref-section` with the index of the reference section
// it stands for (STUDY.md, Home, sections 0 to 12), so the likeness judge can measure it.
export function Home({ copy }: { copy: SiteCopy }) {
  const h = copy.hero;
  return (
    <>
      {/* 0. Hero: title, one line, the main action, and the studio with one editable line */}
      <VStack
        as="section"
        className="site-hero"
        data-ref-section="0"
        aria-labelledby="hero-title"
      >
        <VStack className="site-mesh site-mesh--sky" aria-hidden="true" />
        <VStack className="site-mesh site-mesh--stage" aria-hidden="true" />
        <VStack className="site-hero__copy" hAlign="center">
          <SiteHeading
            level={1}
            id="hero-title"
            type="display-1"
            justify="center"
            className="site-hero__title"
          >
            <SiteText className="site-hero__title-line" color="inherit">
              {h.titleA}
            </SiteText>{" "}
            <SiteText className="site-hero__title-line" color="inherit">
              {h.titleB} <em className="site-accent">{h.accent}</em>
              {h.titleEnd}
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
          <HStack gap={3} justify="center" className="site-hero__actions">
            <SiteButtonLink
              label={h.primary}
              href={href("start")}
              variant="secondary"
              size="lg"
              className="site-hero__primary site-button--inverted"
            />
          </HStack>
        </VStack>
        <VStack className="site-hero__stage">
          <HeroStudio copy={h} />
          <HStack
            className="site-hero__links"
            gap={6}
            justify="center"
            wrap="wrap"
          >
            <HStack gap={2} align="center" wrap="wrap" justify="center">
              <SiteText type="supporting" color="secondary">
                {h.kindsLabel}
              </SiteText>
              {copy.kinds.items.slice(0, 6).map((k) => (
                <SiteLink
                  key={k.name}
                  href={href("songbook")}
                  color="inherit"
                  className="site-pill"
                >
                  {k.name}
                </SiteLink>
              ))}
            </HStack>
            <HStack
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
          </HStack>
        </VStack>
      </VStack>

      {/* 1. Showcase: title, two rows of example songs, the main action */}
      <VStack
        as="section"
        className="site-show"
        data-ref-section="1"
        aria-labelledby="show-title"
        gap={10}
        hAlign="center"
      >
        <VStack gap={3} hAlign="center">
          <SiteHeading
            level={2}
            id="show-title"
            justify="center"
            className="site-title"
          >
            {copy.showcase.title}
          </SiteHeading>
          <SiteText
            as="p"
            type="large"
            color="secondary"
            justify="center"
            className="site-lede"
          >
            {copy.showcase.line}
          </SiteText>
        </VStack>
        <VStack
          className="site-show__rows"
          gap={4}
          aria-label={copy.showcase.examples}
          role="list"
        >
          {[0, 1].map((row) => (
            <HStack
              key={row}
              className={`site-show__row site-show__row--${row}`}
              gap={4}
            >
              {copy.showcase.songs.map((song, i) => (
                <VStack
                  key={song.title}
                  className="site-show__card"
                  role="listitem"
                  gap={3}
                  aria-hidden={row === 1 ? true : undefined}
                >
                  <Cover kind={SHOW_ART[(i + row * 3) % SHOW_ART.length]} />
                  <VStack gap={0.5}>
                    <SiteText weight="medium">{song.title}</SiteText>
                    <SiteText type="supporting" color="secondary">
                      {song.meta}
                    </SiteText>
                  </VStack>
                </VStack>
              ))}
            </HStack>
          ))}
        </VStack>
        <SiteButtonLink
          label={copy.showcase.action}
          href={href("start")}
          variant="secondary"
          size="lg"
          className="site-button--inverted"
        />
      </VStack>

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
            <Card
              key={step.title}
              className="site-step"
              padding={4}
              role="listitem"
            >
              <VStack gap={4}>
                <VStack className="site-step__art" aria-hidden="true">
                  <Wave
                    seed={31 + i * 5}
                    phrases={i + 2}
                    take={i === 1 ? [0.55, 0.75] : undefined}
                  />
                </VStack>
                <VStack gap={1}>
                  <SiteText
                    type="code"
                    color="secondary"
                    className="site-eyebrow"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </SiteText>
                  <SiteHeading level={3} className="site-step__title">
                    {step.title}
                  </SiteHeading>
                  <SiteText as="p" color="secondary">
                    {step.line}
                  </SiteText>
                </VStack>
              </VStack>
            </Card>
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

      {/* 4-6. Features: number, title, points, and a picture of the part */}
      {copy.features.items.map((f, i) => (
        <VStack
          as="article"
          key={f.label}
          className="site-block site-feature"
          data-ref-section={String(4 + i)}
          aria-labelledby={`feature-${i}`}
        >
          <HStack className="site-feature__grid" data-ref-grid>
            <SiteText
              as="p"
              type="code"
              color="secondary"
              className="site-feature__note site-eyebrow"
            >
              {f.label}
            </SiteText>
            <VStack className="site-feature__text" gap={6}>
              <SiteHeading level={3} id={`feature-${i}`} className="site-title">
                {f.title}
              </SiteHeading>
              <VStack as="ol" className="site-feature__points">
                {f.points.map((p) => (
                  <VStack as="li" key={p} className="site-feature__point">
                    <SiteText>{p}</SiteText>
                  </VStack>
                ))}
              </VStack>
            </VStack>
            <VStack
              as="figure"
              className="site-feature__stage site-halo"
              gap={3}
            >
              <FeaturePicture copy={copy} index={i} />
              <SiteText
                as="p"
                type="supporting"
                color="secondary"
                className="site-feature__caption"
              >
                {f.caption}
              </SiteText>
            </VStack>
          </HStack>
        </VStack>
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
      <VStack
        as="section"
        className="site-close"
        data-ref-section="11"
        aria-labelledby="close-title"
      >
        <VStack className="site-close__band">
          <HStack className="site-close__mosaic" aria-hidden="true">
            {SHOW_ART.map((k) => (
              <Cover key={k} kind={k} className="site-close__cover" />
            ))}
          </HStack>
          <VStack
            className="site-close__column"
            data-ref-content
            gap={8}
            hAlign="center"
          >
            <SiteHeading
              level={2}
              id="close-title"
              type="display-2"
              justify="center"
              className="site-close__title"
            >
              {copy.closing.title}
            </SiteHeading>
            <SiteButtonLink
              label={copy.closing.action}
              href={href("start")}
              variant="primary"
              size="lg"
              icon={<SiteIcon icon={ArrowGlyph} size="sm" color="inherit" />}
            />
            <SiteText type="supporting" color="secondary" justify="center">
              {copy.closing.note}
            </SiteText>
          </VStack>
        </VStack>
      </VStack>
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

function FeaturePicture({ copy, index }: { copy: SiteCopy; index: number }) {
  const f = copy.features;
  if (index === 0) {
    const s = f.sheet;
    return (
      <Card className="site-sheet" padding={6} aria-hidden="true">
        <VStack gap={4}>
          <HStack justify="between">
            <SiteText type="code" color="secondary" className="site-eyebrow">
              {s.bar}
            </SiteText>
            <SiteText type="code" color="secondary" className="site-eyebrow">
              {copy.hero.take}
            </SiteText>
          </HStack>
          <VStack as="ol" gap={2} className="site-sheet__lines">
            {s.lines.map((line, i) => (
              <SiteText
                as="p"
                key={line}
                className={`site-sheet__line ${i === s.editLine ? "is-editing" : ""}`}
              >
                {i === s.editLine ? (
                  <>
                    {line.replace(`${s.to},`, "")}
                    <del className="site-studio__old">{s.from}</del>{" "}
                    <ins className="site-studio__new">{s.to}</ins>,
                  </>
                ) : (
                  line
                )}
              </SiteText>
            ))}
          </VStack>
          <SiteText type="supporting" color="secondary">
            {s.foot}
          </SiteText>
        </VStack>
      </Card>
    );
  }
  if (index === 1) {
    return (
      <Card className="site-sheet" padding={6} aria-hidden="true">
        <VStack gap={3}>
          {f.voice.lanes.map((lane, i) => (
            <HStack
              key={lane}
              gap={3}
              align="center"
              className="site-studio__lane"
            >
              <SiteText
                type="code"
                color="secondary"
                className="site-studio__lane-name site-eyebrow"
              >
                {lane}
              </SiteText>
              <Wave
                seed={51 + i * 3}
                phrases={i === 1 ? 0 : 3}
                className={
                  i === 1
                    ? "site-wave--band"
                    : i === 2
                      ? "site-wave--accent"
                      : ""
                }
              />
            </HStack>
          ))}
          <SiteText type="supporting" color="secondary">
            {f.voice.foot}
          </SiteText>
        </VStack>
      </Card>
    );
  }
  return (
    <Card className="site-sheet" padding={6} aria-hidden="true">
      <VStack gap={3}>
        {f.out.rows.map((row, i) => (
          <HStack
            key={row.name}
            gap={3}
            align="center"
            className="site-out__row"
          >
            <Cover
              kind={(["video", "karaoke", "remix"] as CoverKind[])[i]}
              className="site-out__cover"
            />
            <VStack gap={0.5}>
              <SiteText weight="medium">{row.name}</SiteText>
              <SiteText type="supporting" color="secondary">
                {row.meta}
              </SiteText>
            </VStack>
          </HStack>
        ))}
        <SiteText type="supporting" color="secondary">
          {f.out.foot}
        </SiteText>
      </VStack>
    </Card>
  );
}

function StudioPicture({ copy }: { copy: SiteCopy }) {
  return (
    <HStack className="site-shot" aria-hidden="true">
      <VStack className="site-shot__side" gap={2}>
        {copy.showcase.songs.slice(0, 5).map((s, i) => (
          <HStack
            key={s.title}
            gap={2}
            align="center"
            className={`site-shot__song ${i === 0 ? "is-open" : ""}`}
          >
            <Cover kind={SHOW_ART[i]} className="site-shot__cover" />
            <SiteText type="supporting" maxLines={1}>
              {s.title}
            </SiteText>
          </HStack>
        ))}
      </VStack>
      <VStack className="site-shot__main" gap={3}>
        <SiteText type="code" color="secondary" className="site-eyebrow">
          {copy.features.sheet.bar}
        </SiteText>
        {copy.features.sheet.lines.map((line) => (
          <SiteText key={line} className="site-shot__line">
            {line}
          </SiteText>
        ))}
        <Wave seed={77} phrases={4} take={[0.5, 0.66]} />
      </VStack>
    </HStack>
  );
}
