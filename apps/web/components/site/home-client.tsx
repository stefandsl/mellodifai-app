"use client";

import { HStack } from "@astryxdesign/core/HStack";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import { SiteHeading, SiteText } from "@/src/site-primitives";
import { Cover, type CoverKind, coverRings } from "./art";

const KIND_ART: CoverKind[] = [
  "remix",
  "cover",
  "pantomime",
  "satire",
  "translation",
  "karaoke",
  "video",
];

// Reference section 8: a list of seven names beside a stage; the chosen name fills the stage.
export function KindsStage({ copy }: { copy: SiteCopy["kinds"] }) {
  const [active, setActive] = useState(0);
  const kind = copy.items[active];
  const stageConfig = JSON.stringify(
    copy.items.map((k, i) => ({
      name: k.name,
      line: k.line,
      kind: KIND_ART[i],
      rings: coverRings(KIND_ART[i]),
    })),
  );
  return (
    <HStack className="site-kinds__body" data-kinds-stage={stageConfig}>
      <VStack role="group" aria-label={copy.label} className="site-kinds__list">
        {copy.items.map((k, i) => (
          <ToggleButton
            key={k.name}
            label={k.name}
            isPressed={i === active}
            onPressedChange={() => setActive(i)}
            className="site-kinds__name"
          >
            <SiteText color="inherit" className="site-kinds__name-text">
              {k.name}
            </SiteText>
          </ToggleButton>
        ))}
      </VStack>
      <VStack className="site-kinds__stage" gap={4}>
        <Cover kind={KIND_ART[active]} className="site-kinds__cover" />
        <VStack gap={2} className="site-kinds__caption">
          <SiteHeading level={3} className="site-kinds__title">
            {kind.name}
          </SiteHeading>
          <SiteText as="p" color="secondary" aria-live="polite">
            {kind.line}
          </SiteText>
        </VStack>
      </VStack>
    </HStack>
  );
}
