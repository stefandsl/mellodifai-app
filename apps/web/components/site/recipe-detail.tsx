import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import { href, recipeTryHref } from "@/lib/site/nav";
import {
  formatRecipeMeta,
  isVideoFile,
} from "@/lib/site/recipe-detail-helpers";
import type { LoadedRecipe } from "@/lib/site/recipes";
import {
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";
import { CardRow } from "./card-row";
import { ClipPlayer } from "./clip-player";
import { ArrowGlyph, ChevronLeftGlyph } from "./icons";
import { InputsList } from "./inputs-list";

export type RecipeDetailProps = {
  recipe: LoadedRecipe;
  moreRecipes: readonly LoadedRecipe[];
  heroCoverSrc: string;
  lang: SiteLang;
  copy: SiteCopy;
};

// Recipe detail page (C06): back link, kind, title, summary, meta, action button to
// /recipes/<slug>/try, clip player with custom controls and glow, inputs list, and
// more-recipes horizontal row. Pure server-safe primitives; zero client Astryx JS.
export function RecipeDetail({
  recipe,
  moreRecipes,
  heroCoverSrc,
  lang,
  copy,
}: RecipeDetailProps) {
  const detail = copy.recipeDetail;
  const title = recipe.title[lang];
  const summary = recipe.summary[lang];
  const kindLabel = copy.recipes.kinds[recipe.kind];
  const lyricLine = recipe.highlights[0]?.[lang] ?? summary;
  const metaItems = formatRecipeMeta(recipe, detail);
  const video = isVideoFile(recipe.media.example);

  return (
    <>
      <VStack
        as="section"
        className="site-recipe-detail"
        data-ref-section="0"
        data-recipe-detail={recipe.slug}
        aria-labelledby="recipe-detail-title"
        gap={6}
      >
        <VStack className="site-recipe-detail__top" gap={4}>
          <HStack align="center">
            <SiteLink
              href={href("songbook")}
              color="secondary"
              className="site-recipe-detail__back"
            >
              <HStack as="span" align="center" gap={1.5}>
                <SiteIcon icon={ChevronLeftGlyph} size="sm" color="inherit" />
                <SiteText color="inherit">{detail.back}</SiteText>
              </HStack>
            </SiteLink>
          </HStack>

          <HStack
            className="site-recipe-detail__head"
            align="end"
            justify="between"
            gap={6}
            wrap="wrap"
          >
            <VStack
              className="site-recipe-detail__intro"
              data-ref-content
              gap={2}
            >
              <HStack align="center" gap={2}>
                <SiteText
                  type="code"
                  color="secondary"
                  className="site-tag site-recipe-detail__kind"
                >
                  {kindLabel}
                </SiteText>
              </HStack>
              <SiteHeading
                level={1}
                id="recipe-detail-title"
                className="site-title site-recipe-detail__title"
              >
                {title}
              </SiteHeading>
              <SiteText
                as="p"
                color="secondary"
                className="site-recipe-detail__line"
              >
                {summary}
              </SiteText>
              <HStack
                as="ul"
                className="site-recipe-detail__meta"
                align="center"
                gap={2}
                wrap="wrap"
                aria-label={detail.metaOutput}
              >
                {metaItems.map((entry) => (
                  <HStack
                    as="li"
                    key={entry.key}
                    className="site-recipe-detail__meta-item"
                  >
                    <SiteText type="supporting" color="secondary">
                      {entry.text}
                    </SiteText>
                  </HStack>
                ))}
              </HStack>
            </VStack>

            <VStack className="site-recipe-detail__cta" gap={2}>
              <SiteText
                as="p"
                type="supporting"
                color="secondary"
                className="site-recipe-detail__hint"
              >
                {detail.tryHint}
              </SiteText>
              <SiteButtonLink
                href={recipeTryHref(recipe.slug)}
                label={detail.tryAction}
                variant="secondary"
                size="md"
                icon={<SiteIcon icon={ArrowGlyph} size="sm" color="inherit" />}
                className="site-button--inverted site-recipe-detail__try"
                data-recipe-try="true"
              />
            </VStack>
          </HStack>
        </VStack>

        <ClipPlayer
          slug={recipe.slug}
          title={title}
          lyricLine={lyricLine}
          coverSrc={heroCoverSrc}
          mediaSrc={recipe.mediaUrls.example}
          isVideo={video}
          estimatedSeconds={recipe.estimate.seconds}
          copy={detail.player}
        />

        <InputsList inputs={recipe.inputs} lang={lang} copy={detail} />
      </VStack>

      <CardRow
        recipes={moreRecipes}
        lang={lang}
        copy={detail}
        kinds={copy.recipes.kinds}
      />
    </>
  );
}
