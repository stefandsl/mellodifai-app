import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import {
  SiteButton,
  SiteHeading,
  SiteIcon,
  SiteText,
} from "@/src/site-primitives";
import { CopyGlyph } from "./icons";

// Section 4: Floating example prompt chips around a centered composer bar.
export function PromptCloud({ copy }: { copy: SiteCopy["agents"] }) {
  const initialPrompt = copy.prompts[0] ?? "";
  return (
    <VStack
      as="section"
      className="site-agents-prompts"
      data-ref-section="4"
      data-ref-content
      aria-labelledby="prompts-title"
      hAlign="center"
    >
      <SiteHeading
        level={2}
        id="prompts-title"
        justify="center"
        className="site-title site-agents-prompts__title"
      >
        {copy.promptsTitle}
      </SiteHeading>

      <VStack className="site-agents-prompts__stage" gap={6} hAlign="center">
        <HStack
          className="site-agents-prompts__cloud"
          role="group"
          aria-label={copy.promptsListLabel}
          wrap="wrap"
          justify="center"
          gap={3}
        >
          {copy.prompts.slice(0, 3).map((prompt, i) => (
            <SiteButton
              key={prompt}
              label={prompt}
              variant="secondary"
              size="sm"
              className="site-prompt-chip"
              aria-pressed={i === 0}
              data-prompt-chip={String(i)}
              data-prompt-text={prompt}
            >
              {prompt}
            </SiteButton>
          ))}
        </HStack>

        <HStack
          className="site-agents-prompts__bar"
          data-ref-grid
          align="start"
        >
          <SiteText
            as="p"
            className="site-agents-prompts__active"
            data-prompt-active="true"
          >
            {initialPrompt}
          </SiteText>
          <SiteButton
            label={copy.promptsCopyLabel}
            variant="secondary"
            size="sm"
            className="site-button--inverted site-agents-prompts__copy"
            icon={<SiteIcon icon={CopyGlyph} size="sm" color="inherit" />}
            data-copy-button="true"
            data-prompt-copy-btn="true"
            data-copy-text={initialPrompt}
            data-copy-label={copy.promptsCopyLabel}
          >
            <SiteText
              color="inherit"
              className="site-agents-prompts__copy-text"
              data-btn-label="true"
            >
              {copy.copyButton}
            </SiteText>
          </SiteButton>
        </HStack>

        <HStack
          className="site-agents-prompts__cloud"
          role="group"
          aria-label={copy.promptsListLabel}
          wrap="wrap"
          justify="center"
          gap={3}
        >
          {copy.prompts.slice(3, 6).map((prompt, idx) => {
            const i = idx + 3;
            return (
              <SiteButton
                key={prompt}
                label={prompt}
                variant="secondary"
                size="sm"
                className="site-prompt-chip"
                aria-pressed={false}
                data-prompt-chip={String(i)}
                data-prompt-text={prompt}
              >
                {prompt}
              </SiteButton>
            );
          })}
        </HStack>
      </VStack>
    </VStack>
  );
}
