import { HStack } from "@astryxdesign/core/HStack";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { SiteHeading, SiteText } from "@/src/site-primitives";
import { Cover, type CoverKind } from "./art";

const KIND_ART: CoverKind[] = [
  "remix",
  "cover",
  "pantomime",
  "satire",
  "translation",
  "karaoke",
  "video",
];

// Reference section 8: sticky block on desktop (2700 px scroll travel across 7 recipe kinds),
// static stacked block on phones. The vanilla island in lib/site/islands/home.ts drives scroll
// progress and manual button selection with cross-fading cover slides.
export function KindStage({ copy }: { copy: SiteCopy["kinds"] }) {
  const first = copy.items[0];
  const stageConfig = JSON.stringify(
    copy.items.map((k, i) => ({
      name: k.name,
      line: k.line,
      kind: KIND_ART[i],
    })),
  );

  return (
    <VStack className="site-kinds__track" data-kinds-track="true">
      <VStack className="site-kinds__sticky" data-kinds-sticky="true" gap={10}>
        <VStack gap={3}>
          <SiteHeading level={2} id="kinds-title" className="site-title">
            {copy.title}
          </SiteHeading>
          <SiteText as="p" type="large" color="secondary">
            {copy.line}
          </SiteText>
        </VStack>
        <HStack
          className="site-kinds__body"
          data-kinds-stage={stageConfig}
          data-kind-active="0"
        >
          <VStack
            role="group"
            aria-label={copy.label}
            className="site-kinds__list"
          >
            {copy.items.map((k, i) => (
              <ToggleButton
                key={k.name}
                label={k.name}
                isPressed={i === 0}
                className="site-kinds__name"
                data-kind-index={String(i)}
              >
                <SiteText color="inherit" className="site-kinds__name-text">
                  {k.name}
                </SiteText>
              </ToggleButton>
            ))}
          </VStack>
          <VStack className="site-kinds__stage" gap={4}>
            <VStack className="site-kinds__media" aria-hidden="true">
              {copy.items.map((k, i) => (
                <VStack
                  key={k.name}
                  className="site-kinds__slide"
                  data-kind-slide={String(i)}
                  data-active={i === 0 ? "true" : "false"}
                >
                  <Cover kind={KIND_ART[i]} className="site-kinds__cover" />
                </VStack>
              ))}
            </VStack>
            <VStack gap={2} className="site-kinds__caption">
              <SiteHeading level={3} className="site-kinds__title">
                {first.name}
              </SiteHeading>
              <SiteText as="p" color="secondary" data-kind-line="true">
                {first.line}
              </SiteText>
            </VStack>
            <SiteText
              as="p"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="site-sr-only"
              data-kind-status="true"
            />
          </VStack>
        </HStack>
      </VStack>
      <VStack
        className="site-kinds__runway"
        data-kinds-runway="true"
        aria-hidden="true"
      />
    </VStack>
  );
}
