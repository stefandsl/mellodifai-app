import { VStack } from "@astryxdesign/core/VStack";
import type { ChangelogEntry } from "@/lib/site/changelog-types";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import { SiteHeading, SiteText } from "@/src/site-primitives";
import { ReleaseEntry } from "./release-entry";
import { ReleaseRuler } from "./release-ruler";

export type ChangelogPageProps = {
  entries: readonly ChangelogEntry[];
  lang: SiteLang;
  copy: SiteCopy;
};

// Changelog page (C09): page head (section 0), sticky release ruler (section 1),
// dated entries list (section 2), followed by shared SiteFooter (section 3).
// Pure server-safe primitives; zero client Astryx JS.
export function ChangelogPage({ entries, lang, copy }: ChangelogPageProps) {
  const c = copy.changelog;

  return (
    <>
      <VStack
        as="section"
        className="site-changelog-head"
        data-ref-section="0"
        aria-labelledby="changelog-title"
        hAlign="center"
        gap={6}
      >
        <SiteHeading
          level={1}
          id="changelog-title"
          className="site-changelog-head__title"
          justify="center"
        >
          {c.title}
        </SiteHeading>
        <SiteText
          as="p"
          color="secondary"
          justify="center"
          className="site-changelog-head__line"
          data-ref-content
        >
          {c.line}
        </SiteText>
      </VStack>

      <ReleaseRuler entries={entries} copy={c} />

      <VStack
        as="section"
        className="site-changelog-entries"
        data-ref-section="2"
        aria-label={c.entriesLabel}
      >
        {entries.map((entry, idx) => (
          <ReleaseEntry
            key={entry.id}
            entry={entry}
            lang={lang}
            isFirstRefGrid={idx === 0}
          />
        ))}
      </VStack>
    </>
  );
}
