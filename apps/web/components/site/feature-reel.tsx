"use client";

import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { SiteHeading, SiteText } from "@/src/site-primitives";
import { Cover, type CoverKind, Wave } from "./art";

// Reference sections 4 to 6: numbered feature article with a 3-step bullet list
// and a 3-panel carousel that advances every 5.0 s and pauses on hover.
export function FeatureReel({
  copy,
  index,
}: {
  copy: SiteCopy;
  index: number;
}) {
  const f = copy.features.items[index];
  const stepCount = f.points.length;

  return (
    <VStack
      as="article"
      className="site-block site-feature"
      data-ref-section={String(4 + index)}
      data-feature-reel={String(index)}
      data-reel-step="0"
      data-reel-count={String(stepCount)}
      data-reel-paused="false"
      aria-labelledby={`feature-${index}`}
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
          <SiteHeading level={3} id={`feature-${index}`} className="site-title">
            {f.title}
          </SiteHeading>
          <VStack as="ol" className="site-feature__points">
            {f.points.map((point, stepIdx) => (
              <VStack
                as="li"
                key={point}
                className="site-feature__point"
                data-active={stepIdx === 0 ? "true" : "false"}
              >
                <ToggleButton
                  label={point}
                  isPressed={stepIdx === 0}
                  className="site-feature__bullet"
                  data-reel-bullet={String(stepIdx)}
                  data-active={stepIdx === 0 ? "true" : "false"}
                />
              </VStack>
            ))}
          </VStack>
        </VStack>
        <VStack as="figure" className="site-feature__stage site-halo" gap={3}>
          <VStack className="site-feature__viewport">
            <HStack className="site-feature__track" data-reel-track="true">
              <FeatureSlides copy={copy} index={index} />
            </HStack>
          </VStack>
          <HStack
            justify="between"
            align="center"
            gap={3}
            wrap="wrap"
            className="site-feature__foot"
          >
            <SiteText
              as="p"
              type="supporting"
              color="secondary"
              className="site-feature__caption"
            >
              {f.caption}
            </SiteText>
            <HStack
              role="group"
              aria-label={copy.features.dotsLabel}
              gap={2}
              align="center"
              className="site-feature__dots"
            >
              {f.points.map((point, stepIdx) => (
                <ToggleButton
                  key={point}
                  label={`${copy.features.stepLabel} ${stepIdx + 1}`}
                  isPressed={stepIdx === 0}
                  className="site-feature__dot"
                  data-reel-dot={String(stepIdx)}
                >
                  <SiteText
                    className="site-feature__dot-mark"
                    aria-hidden="true"
                  />
                </ToggleButton>
              ))}
            </HStack>
          </HStack>
        </VStack>
      </HStack>
    </VStack>
  );
}

function FeatureSlides({ copy, index }: { copy: SiteCopy; index: number }) {
  const f = copy.features;
  if (index === 0) {
    const s = f.sheet;
    return (
      <>
        <VStack className="site-feature__slide" data-reel-slide="0">
          <Card className="site-sheet" padding={6}>
            <VStack gap={4}>
              <HStack justify="between">
                <SiteText
                  type="code"
                  color="secondary"
                  className="site-eyebrow"
                >
                  {s.bar}
                </SiteText>
                <SiteText
                  type="code"
                  color="secondary"
                  className="site-eyebrow"
                >
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
        </VStack>
        <VStack
          className="site-feature__slide"
          data-reel-slide="1"
          aria-hidden="true"
        >
          <Card className="site-sheet" padding={6}>
            <VStack gap={4}>
              <SiteText type="code" color="secondary" className="site-eyebrow">
                {s.takesTitle}
              </SiteText>
              <VStack gap={3}>
                {s.takes.map((t, i) => (
                  <HStack
                    key={t.tag}
                    justify="between"
                    align="center"
                    gap={3}
                    className="site-reel__row"
                  >
                    <HStack gap={3} align="center">
                      <SiteText
                        type="code"
                        className={`site-tag ${i === s.takes.length - 1 ? "site-tag--accent" : ""}`}
                      >
                        {t.tag}
                      </SiteText>
                      <SiteText>{t.line}</SiteText>
                    </HStack>
                    <SiteText type="supporting" color="secondary">
                      {t.state}
                    </SiteText>
                  </HStack>
                ))}
              </VStack>
              <SiteText type="supporting" color="secondary">
                {s.foot}
              </SiteText>
            </VStack>
          </Card>
        </VStack>
        <VStack
          className="site-feature__slide"
          data-reel-slide="2"
          aria-hidden="true"
        >
          <Card className="site-sheet" padding={6}>
            <VStack gap={4}>
              <SiteText type="code" color="secondary" className="site-eyebrow">
                {s.undoTitle}
              </SiteText>
              <VStack gap={2}>
                <SiteText as="p" className="site-sheet__line is-editing">
                  {s.undoBefore}
                </SiteText>
                <SiteText as="p" color="secondary" className="site-sheet__line">
                  {s.undoAfter}
                </SiteText>
              </VStack>
              <SiteText type="supporting" color="secondary">
                {s.undoFoot}
              </SiteText>
            </VStack>
          </Card>
        </VStack>
      </>
    );
  }

  if (index === 1) {
    const v = f.voice;
    return (
      <>
        <VStack className="site-feature__slide" data-reel-slide="0">
          <Card className="site-sheet" padding={6}>
            <VStack gap={3}>
              {v.lanes.map((lane, i) => (
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
                {v.foot}
              </SiteText>
            </VStack>
          </Card>
        </VStack>
        <VStack
          className="site-feature__slide"
          data-reel-slide="1"
          aria-hidden="true"
        >
          <Card className="site-sheet" padding={6}>
            <VStack gap={4}>
              <SiteText type="code" color="secondary" className="site-eyebrow">
                {v.swapTitle}
              </SiteText>
              <VStack gap={3}>
                {v.swapRoles.map((role, i) => (
                  <HStack
                    key={role.tag}
                    gap={3}
                    align="center"
                    className="site-reel__row"
                  >
                    <SiteText
                      type="code"
                      className={`site-tag ${i === 1 ? "site-tag--accent" : ""}`}
                    >
                      {role.tag}
                    </SiteText>
                    <SiteText type="supporting" color="secondary">
                      {role.detail}
                    </SiteText>
                  </HStack>
                ))}
              </VStack>
              <SiteText type="supporting" color="secondary">
                {v.swapFoot}
              </SiteText>
            </VStack>
          </Card>
        </VStack>
        <VStack
          className="site-feature__slide"
          data-reel-slide="2"
          aria-hidden="true"
        >
          <Card className="site-sheet" padding={6}>
            <VStack gap={4}>
              <SiteText type="code" color="secondary" className="site-eyebrow">
                {v.timingTitle}
              </SiteText>
              <HStack gap={2} wrap="wrap">
                {v.timingBars.map((word) => (
                  <SiteText key={word} type="code" className="site-tag">
                    {word}
                  </SiteText>
                ))}
              </HStack>
              <Wave seed={89} phrases={3} className="site-wave--accent" />
              <SiteText type="supporting" color="secondary">
                {v.timingFoot}
              </SiteText>
            </VStack>
          </Card>
        </VStack>
      </>
    );
  }

  const o = f.out;
  return (
    <>
      <VStack className="site-feature__slide" data-reel-slide="0">
        <Card className="site-sheet" padding={6}>
          <VStack gap={3}>
            {o.rows.map((row, i) => (
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
              {o.foot}
            </SiteText>
          </VStack>
        </Card>
      </VStack>
      <VStack
        className="site-feature__slide"
        data-reel-slide="1"
        aria-hidden="true"
      >
        <Card className="site-sheet" padding={6}>
          <VStack gap={4}>
            <SiteText type="code" color="secondary" className="site-eyebrow">
              {o.karaokeTitle}
            </SiteText>
            <SiteText as="p" className="site-sheet__line is-editing">
              {o.karaokeLine}
            </SiteText>
            <Wave seed={97} phrases={0} className="site-wave--band" />
            <SiteText type="supporting" color="secondary">
              {o.karaokeMeta}
            </SiteText>
          </VStack>
        </Card>
      </VStack>
      <VStack
        className="site-feature__slide"
        data-reel-slide="2"
        aria-hidden="true"
      >
        <Card className="site-sheet" padding={6}>
          <VStack gap={4}>
            <SiteText type="code" color="secondary" className="site-eyebrow">
              {o.formatsTitle}
            </SiteText>
            <VStack gap={3}>
              {o.formats.map((fmt) => (
                <HStack
                  key={fmt.tag}
                  gap={3}
                  align="center"
                  className="site-reel__row"
                >
                  <SiteText type="code" className="site-tag">
                    {fmt.tag}
                  </SiteText>
                  <SiteText type="supporting" color="secondary">
                    {fmt.detail}
                  </SiteText>
                </HStack>
              ))}
            </VStack>
            <SiteText type="supporting" color="secondary">
              {o.foot}
            </SiteText>
          </VStack>
        </Card>
      </VStack>
    </>
  );
}
