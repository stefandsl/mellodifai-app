import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { RecipeInput } from "@mellodifai/shared";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import {
  formatInputHint,
  formatInputLimit,
} from "@/lib/site/recipe-detail-helpers";
import { SiteHeading, SiteText } from "@/src/site-primitives";

export type InputsListProps = {
  inputs: readonly RecipeInput[];
  lang: SiteLang;
  copy: SiteCopy["recipeDetail"];
};

// Two-column list of inputs the visitor brings to the recipe (1 column on phones).
// Marks data-ref-grid at 1440 and 390 to match the recipe-detail layout reference.
export function InputsList({ inputs, lang, copy }: InputsListProps) {
  return (
    <VStack
      className="site-inputs"
      gap={4}
      aria-labelledby="recipe-inputs-title"
    >
      <SiteHeading
        level={2}
        id="recipe-inputs-title"
        className="site-inputs__heading"
      >
        {copy.inputsTitle}
      </SiteHeading>
      <VStack
        as="ul"
        className="site-inputs__grid"
        data-ref-grid
        data-ref-grid-widths="1440,390"
      >
        {inputs.map((input) => {
          const limit = formatInputLimit(input, copy);
          const hint = formatInputHint(input, lang, copy);
          return (
            <VStack as="li" key={input.id} className="site-inputs__row" gap={1}>
              <HStack
                className="site-inputs__top"
                align="baseline"
                justify="between"
                gap={3}
              >
                <SiteText weight="medium" className="site-inputs__name">
                  {input.label[lang]}
                </SiteText>
                <SiteText
                  type="supporting"
                  color="secondary"
                  className="site-inputs__meta"
                >
                  {limit}
                </SiteText>
              </HStack>
              <SiteText
                as="p"
                type="supporting"
                color="secondary"
                className="site-inputs__hint"
              >
                {hint}
              </SiteText>
            </VStack>
          );
        })}
      </VStack>
    </VStack>
  );
}
