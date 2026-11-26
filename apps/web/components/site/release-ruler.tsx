import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import {
  type ChangelogEntry,
  formatChangelogDate,
} from "@/lib/site/changelog-types";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import { SiteLink, SiteText } from "@/src/site-primitives";

// Deterministic tick heights for our own changelog waveform ruler (no reference SVG).
const RULER_TICKS = Array.from({ length: 120 }, (_, i) => {
  const major = i % 10 === 0;
  const medium = i % 5 === 0;
  return {
    x: i * 10 + 5,
    y1: major ? 2 : medium ? 7 : 12,
    y2: 20,
    major,
  };
});

export type ReleaseRulerProps = {
  entries: readonly ChangelogEntry[];
  lang: SiteLang;
  copy: SiteCopy["changelog"];
};

// Sticky release ruler (reference section 1): tick strip and horizontal rail of dated
// release chips. Pure server-safe primitives; enhanced by lib/site/islands/changelog.ts.
export function ReleaseRuler({ entries, lang, copy }: ReleaseRulerProps) {
  return (
    <VStack
      as="section"
      className="site-ruler"
      data-ref-section="1"
      data-release-ruler="true"
      aria-label={copy.rulerLabel}
    >
      <VStack className="site-ruler__inner" gap={2}>
        <svg
          className="site-ruler__ticks"
          viewBox="0 0 1200 22"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {RULER_TICKS.map((tick) => (
            <line
              key={tick.x}
              x1={tick.x}
              y1={tick.y1}
              x2={tick.x}
              y2={tick.y2}
              className={
                tick.major
                  ? "site-ruler__tick site-ruler__tick--major"
                  : "site-ruler__tick"
              }
            />
          ))}
        </svg>

        <HStack
          as="nav"
          className="site-ruler__nav"
          aria-label={copy.rulerNavLabel}
        >
          <HStack
            as="ul"
            className="site-ruler__track"
            data-release-ruler-track="true"
            gap={2}
            align="center"
          >
            {entries.map((entry, index) => {
              const shortDate = formatChangelogDate(
                entry.isoDate,
                lang,
                "short",
              );
              const isCurrent = index === 0;
              return (
                <HStack
                  as="li"
                  key={entry.id}
                  className="site-ruler__item"
                  align="center"
                >
                  <SiteLink
                    href={`#${entry.id}`}
                    color="inherit"
                    className="site-ruler__chip"
                    data-release-chip={entry.id}
                    data-release-tag={entry.tag}
                    aria-current={isCurrent ? "location" : undefined}
                  >
                    <HStack
                      as="span"
                      className="site-ruler__chip-inner"
                      align="center"
                      gap={1.5}
                    >
                      <SiteText
                        type="code"
                        color="inherit"
                        className="site-ruler__chip-date"
                      >
                        {shortDate}
                      </SiteText>
                      <SiteText
                        type="code"
                        color="inherit"
                        className="site-ruler__chip-tag"
                      >
                        {entry.tag}
                      </SiteText>
                    </HStack>
                  </SiteLink>
                </HStack>
              );
            })}
          </HStack>
        </HStack>
      </VStack>
    </VStack>
  );
}
