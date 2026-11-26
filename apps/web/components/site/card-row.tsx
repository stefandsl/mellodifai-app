import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import Image from "next/image";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import { href, recipeHref } from "@/lib/site/nav";
import { MORE_CARD_IMAGE_SIZES } from "@/lib/site/recipe-detail-helpers";
import type { LoadedRecipe } from "@/lib/site/recipes";
import {
  SiteHeading,
  SiteIcon,
  SiteIconButton,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";
import { Cover } from "./art";
import { ChevronLeftGlyph, ChevronRightGlyph } from "./icons";

export type CardRowProps = {
  recipes: readonly LoadedRecipe[];
  lang: SiteLang;
  copy: SiteCopy["recipeDetail"];
  kinds: SiteCopy["recipes"]["kinds"];
};

const TARGET_ROW_ITEMS = 12;

// Horizontal scrollable row of related song recipes with previous/next arrow controls.
// When fewer than 12 other recipes exist, appends a final songbook link card so the
// 12-card rail rhythm matches the layout reference without duplicating any recipe.
export function CardRow({ recipes, lang, copy, kinds }: CardRowProps) {
  const shown = recipes.slice(0, TARGET_ROW_ITEMS);
  const needsBrowseCard = shown.length < TARGET_ROW_ITEMS;

  return (
    <VStack
      as="section"
      className="site-card-row"
      data-ref-section="1"
      data-ref-content
      data-card-row="true"
      aria-labelledby="more-recipes-title"
      gap={4}
    >
      <HStack
        className="site-card-row__head"
        align="center"
        justify="between"
        gap={3}
      >
        <SiteHeading
          level={2}
          id="more-recipes-title"
          className="site-card-row__title"
        >
          {copy.moreTitle}
        </SiteHeading>
        <HStack align="center" gap={2} className="site-card-row__arrows">
          <SiteIconButton
            label={copy.morePrev}
            icon={
              <SiteIcon icon={ChevronLeftGlyph} size="sm" color="inherit" />
            }
            variant="ghost"
            size="sm"
            className="site-card-row__arrow"
            data-card-row-prev="true"
          />
          <SiteIconButton
            label={copy.moreNext}
            icon={
              <SiteIcon icon={ChevronRightGlyph} size="sm" color="inherit" />
            }
            variant="ghost"
            size="sm"
            className="site-card-row__arrow"
            data-card-row-next="true"
          />
        </HStack>
      </HStack>

      <HStack
        as="ul"
        className="site-card-row__track"
        aria-label={copy.moreTrackLabel}
        data-ref-grid
        data-card-row-track="true"
      >
        {shown.map((item) => {
          const itemTitle = item.title[lang];
          return (
            <VStack as="li" key={item.slug} className="site-card-row__item">
              <article className="site-card-row__card">
                <VStack className="site-card-row__media">
                  <Image
                    src={item.mediaUrls.cover}
                    alt={itemTitle}
                    fill
                    unoptimized
                    loading="lazy"
                    sizes={MORE_CARD_IMAGE_SIZES}
                    className="site-card-row__img"
                  />
                </VStack>
                <VStack className="site-card-row__body" gap={0.5}>
                  <SiteLink
                    href={recipeHref(item.slug)}
                    color="inherit"
                    className="site-card-row__link"
                  >
                    <SiteText weight="medium" maxLines={1}>
                      {itemTitle}
                    </SiteText>
                  </SiteLink>
                  <SiteText
                    type="supporting"
                    color="secondary"
                    maxLines={1}
                    className="site-card-row__kind"
                  >
                    {kinds[item.kind]}
                  </SiteText>
                </VStack>
              </article>
            </VStack>
          );
        })}

        {needsBrowseCard ? (
          <VStack as="li" className="site-card-row__item">
            <article className="site-card-row__card site-card-row__card--browse">
              <VStack className="site-card-row__media">
                <Cover kind="remix" className="site-card-row__browse-art" />
              </VStack>
              <VStack className="site-card-row__body" gap={0.5}>
                <SiteLink
                  href={href("songbook")}
                  color="inherit"
                  className="site-card-row__link"
                >
                  <SiteText weight="medium" maxLines={1}>
                    {copy.moreBrowseTitle}
                  </SiteText>
                </SiteLink>
                <SiteText
                  type="supporting"
                  color="secondary"
                  maxLines={1}
                  className="site-card-row__kind"
                >
                  {copy.moreBrowseKind}
                </SiteText>
              </VStack>
            </article>
          </VStack>
        ) : null}
      </HStack>
    </VStack>
  );
}
