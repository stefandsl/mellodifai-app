import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { SiteText } from "@/src/site-primitives";
import { Cover, type CoverKind, Wave } from "./art";

const SHOT_ART: CoverKind[] = [
  "remix",
  "cover",
  "satire",
  "translation",
  "karaoke",
];

// Reference section 7: repo-owned studio preview matching the layout of the MellodifAI studio
// (song list on the left, lyric sheet + waveform in the middle, saved takes on the right).
export function StudioShot({ copy }: { copy: SiteCopy }) {
  const sheet = copy.features.sheet;
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
            <Cover kind={SHOT_ART[i]} className="site-shot__cover" />
            <SiteText type="supporting" maxLines={1}>
              {s.title}
            </SiteText>
          </HStack>
        ))}
      </VStack>
      <VStack className="site-shot__main" gap={3}>
        <HStack justify="between" align="center" gap={2}>
          <SiteText type="code" color="secondary" className="site-eyebrow">
            {sheet.bar}
          </SiteText>
          <SiteText type="code" className="site-tag site-tag--accent">
            {copy.hero.take}
          </SiteText>
        </HStack>
        {sheet.lines.map((line) => (
          <SiteText key={line} className="site-shot__line">
            {line}
          </SiteText>
        ))}
        <Wave seed={77} phrases={4} take={[0.5, 0.66]} />
      </VStack>
      <VStack className="site-shot__takes" gap={2}>
        <SiteText type="code" color="secondary" className="site-eyebrow">
          {sheet.takesTitle}
        </SiteText>
        {sheet.takes.map((take, i) => (
          <VStack
            key={take.tag}
            gap={0.5}
            className={`site-shot__take ${i === sheet.takes.length - 1 ? "is-open" : ""}`}
          >
            <HStack justify="between" align="center" gap={2}>
              <SiteText type="code" className="site-eyebrow">
                {take.tag}
              </SiteText>
              <SiteText type="supporting" color="secondary">
                {take.state}
              </SiteText>
            </HStack>
            <SiteText type="supporting" color="secondary" maxLines={1}>
              {take.line}
            </SiteText>
          </VStack>
        ))}
      </VStack>
    </HStack>
  );
}
