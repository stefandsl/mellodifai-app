"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { href } from "@/lib/site/nav";
import { SiteIcon, SiteText } from "@/src/site-primitives";
import { ArrowGlyph } from "./icons";

// Hero prompt composer (STUDY.md Home section 0, MAPPING.md 3.1).
// Submits via GET to sign-in with the draft prompt preserved in the query string,
// never posting data before authentication. Interactive chip fills and submit
// navigation are wired by the lightweight home vanilla island.
export function HeroComposer({ copy }: { copy: SiteCopy["hero"] }) {
  return (
    <VStack className="site-composer-wrap" gap={4} hAlign="center">
      <form
        method="get"
        action={href("signIn")}
        className="site-composer"
        data-hero-composer="true"
      >
        <VStack gap={3} className="site-composer__inner">
          <textarea
            id="hero-composer-input"
            name="prompt"
            rows={2}
            aria-label={copy.composerLabel}
            placeholder={copy.composerPlaceholder}
            className="site-composer__input"
          />
          <HStack
            className="site-composer__bar"
            justify="between"
            align="center"
            gap={3}
            wrap="wrap"
          >
            <SiteText
              type="supporting"
              color="secondary"
              className="site-composer__hint"
            >
              {copy.composerHint}
            </SiteText>
            <Button
              type="submit"
              label={copy.primary}
              variant="secondary"
              size="lg"
              icon={<SiteIcon icon={ArrowGlyph} size="sm" color="inherit" />}
              className="site-hero__primary site-button--inverted"
            />
          </HStack>
        </VStack>
      </form>
      <HStack
        role="group"
        aria-label={copy.chipsLabel}
        gap={2}
        wrap="wrap"
        justify="center"
        className="site-composer__chips"
      >
        {copy.chips.map((chip) => (
          <ToggleButton
            key={chip.label}
            label={chip.label}
            isPressed={false}
            className="site-chip"
            data-chip-prompt={chip.prompt}
          />
        ))}
      </HStack>
    </VStack>
  );
}
