import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import { href } from "@/lib/site/nav";
import {
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";
import { Cover, type CoverKind, Wave } from "./art";
import { ArrowGlyph } from "./icons";

export const SHOW_ART: CoverKind[] = [
  "remix",
  "cover",
  "satire",
  "translation",
  "karaoke",
  "video",
  "pantomime",
];

export type ShowcaseSectionProps = {
  copy: SiteCopy["showcase"];
  sectionIndex: number;
  titleId: string;
  title?: string;
  line?: string;
  className?: string;
  action?: ReactNode;
};

// Reused moving two-row showcase of example songs (Home section 1, Desktop section 4).
export function ShowcaseSection({
  copy,
  sectionIndex,
  titleId,
  title,
  line,
  className,
  action,
}: ShowcaseSectionProps) {
  const showLine = line === undefined ? copy.line : line;
  return (
    <VStack
      as="section"
      className={className ? `site-show ${className}` : "site-show"}
      data-ref-section={String(sectionIndex)}
      aria-labelledby={titleId}
      gap={10}
      hAlign="center"
    >
      <VStack gap={3} hAlign="center">
        <SiteHeading
          level={2}
          id={titleId}
          justify="center"
          className="site-title"
        >
          {title ?? copy.title}
        </SiteHeading>
        {showLine ? (
          <SiteText
            as="p"
            type="large"
            color="secondary"
            justify="center"
            className="site-lede"
          >
            {showLine}
          </SiteText>
        ) : null}
      </VStack>
      <VStack className="site-show__rows" gap={4} aria-label={copy.examples}>
        {[0, 1].map((row) => {
          const base = copy.songs.slice(0, 6);
          const ordered =
            row === 0 ? base : [...base.slice(3), ...base.slice(0, 3)];
          return (
            <VStack
              key={row}
              className="site-show__viewport"
              data-marquee-row={String(row)}
              data-marquee-direction={row === 0 ? "-1" : "1"}
              data-marquee-paused="false"
            >
              <HStack className="site-show__track" data-marquee-track="true">
                {[0, 1].map((copyIdx) => (
                  <HStack
                    key={copyIdx}
                    className="site-show__copy"
                    gap={4}
                    role={copyIdx === 0 ? "list" : undefined}
                    aria-hidden={copyIdx === 1 ? true : undefined}
                    data-marquee-copy={String(copyIdx)}
                  >
                    {ordered.map((song, i) => (
                      <VStack
                        key={`${copyIdx}-${song.title}`}
                        className="site-show__card"
                        role={copyIdx === 0 ? "listitem" : undefined}
                        gap={3}
                      >
                        <Cover
                          kind={
                            (song.kind as CoverKind) ??
                            SHOW_ART[(i + row * 3) % SHOW_ART.length]
                          }
                        />
                        <VStack gap={0.5}>
                          <SiteLink
                            href={href("songbook")}
                            color="primary"
                            weight="medium"
                            className="site-show__card-link"
                            tabIndex={copyIdx === 1 ? -1 : undefined}
                          >
                            {song.title}
                          </SiteLink>
                          <SiteText type="supporting" color="secondary">
                            {song.meta}
                          </SiteText>
                        </VStack>
                      </VStack>
                    ))}
                  </HStack>
                ))}
              </HStack>
            </VStack>
          );
        })}
      </VStack>
      {action ?? (
        <SiteButtonLink
          label={copy.action}
          href={href("start")}
          variant="secondary"
          size="lg"
          className="site-button--inverted"
        />
      )}
    </VStack>
  );
}

export type StepCardProps = {
  index: number;
  title: string;
  line: string;
};

// Reused numbered step card with waveform artwork (Home section 2, Desktop section 6).
export function StepCard({ index, title, line }: StepCardProps) {
  return (
    <Card className="site-step" padding={4} role="listitem">
      <VStack gap={4}>
        <VStack className="site-step__art" aria-hidden="true">
          <Wave
            seed={31 + index * 5}
            phrases={index + 2}
            take={index === 1 ? [0.55, 0.75] : undefined}
          />
        </VStack>
        <VStack gap={1}>
          <SiteText type="code" color="secondary" className="site-eyebrow">
            {String(index + 1).padStart(2, "0")}
          </SiteText>
          <SiteHeading level={3} className="site-step__title">
            {title}
          </SiteHeading>
          <SiteText as="p" color="secondary">
            {line}
          </SiteText>
        </VStack>
      </VStack>
    </Card>
  );
}

export type ClosingBandProps = {
  sectionIndex: number;
  titleId: string;
  title: string;
  action?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  note?: string;
  notes?: readonly [string, string];
  covers?: readonly CoverKind[];
  className?: string;
};

// Reused closing CTA band with cover mosaic (Home, Recipes, Desktop).
export function ClosingBand({
  sectionIndex,
  titleId,
  title,
  action,
  actionLabel,
  actionHref,
  note,
  notes,
  covers = SHOW_ART,
  className,
}: ClosingBandProps) {
  return (
    <VStack
      as="section"
      className={className ? `site-close ${className}` : "site-close"}
      data-ref-section={String(sectionIndex)}
      aria-labelledby={titleId}
    >
      <VStack className="site-close__band">
        <HStack className="site-close__mosaic" aria-hidden="true">
          {covers.map((k) => (
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
            id={titleId}
            type="display-2"
            justify="center"
            className="site-close__title"
          >
            {title}
          </SiteHeading>
          {action ?? (
            <SiteButtonLink
              label={actionLabel ?? ""}
              href={actionHref ?? href("start")}
              variant="primary"
              size="lg"
              icon={<SiteIcon icon={ArrowGlyph} size="sm" color="inherit" />}
            />
          )}
          {note ? (
            <SiteText type="supporting" color="secondary" justify="center">
              {note}
            </SiteText>
          ) : null}
        </VStack>
        {notes ? (
          <HStack
            className="site-close__notes"
            data-ref-grid
            data-ref-grid-widths="1440"
          >
            <SiteText
              type="supporting"
              color="secondary"
              justify="center"
              className="site-close__note-item"
            >
              {notes[0]}
            </SiteText>
            <SiteText
              type="supporting"
              color="secondary"
              justify="center"
              className="site-close__note-item"
            >
              {notes[1]}
            </SiteText>
          </HStack>
        ) : null}
      </VStack>
    </VStack>
  );
}

// Reused studio window preview artwork (Home section 7, Desktop hero).
export function StudioPicture({ copy }: { copy: SiteCopy }) {
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
