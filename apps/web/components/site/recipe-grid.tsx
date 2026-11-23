import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import type { LoadedRecipe } from "@/lib/site/recipes";
import { RecipeCard } from "./recipe-card";
import { SearchField } from "./search-field";

// Multi-column grid view (?view=grid) of the recipes index.
// Renders on the server with zero client requirement (works with JavaScript off);
// when hydrated, search filters locally with zero network requests and dims non-matches.
export function RecipeGrid({
  recipes,
  matchIds,
  query,
  onQueryChange,
  lang,
  copy,
  closingBand,
}: {
  recipes: readonly LoadedRecipe[];
  matchIds: ReadonlySet<string> | null;
  query: string;
  onQueryChange: (next: string) => void;
  lang: SiteLang;
  copy: SiteCopy["recipes"];
  closingBand: ReactNode;
}) {
  const searching = matchIds !== null;
  const noMatches = searching && matchIds.size === 0;

  const ordered =
    searching && matchIds.size > 0
      ? [
          ...recipes.filter((r) => matchIds.has(r.id)),
          ...recipes.filter((r) => !matchIds.has(r.id)),
        ]
      : recipes;

  return (
    <VStack className="site-recipes-grid-root" data-recipes-view="grid">
      {/* 0. Head: title, one line, search field */}
      <VStack
        as="section"
        className="site-recipes-grid-head"
        data-ref-section="0"
        aria-labelledby="recipes-title"
      >
        <Heading level={1} id="recipes-title" className="site-recipes-title">
          {copy.title}
        </Heading>
        <Text
          as="p"
          type="large"
          color="secondary"
          justify="center"
          className="site-recipes-line"
        >
          {copy.line}
        </Text>
        <SearchField
          value={query}
          onChange={onQueryChange}
          label={copy.searchLabel}
          placeholder={copy.searchPlaceholder}
          clearLabel={copy.clearSearch}
        />
        {noMatches ? (
          <VStack
            role="status"
            aria-live="polite"
            className="site-recipes-empty"
            gap={2}
            hAlign="center"
            data-recipes-empty="true"
          >
            <Text weight="medium">{copy.empty}</Text>
            <Text type="supporting" color="secondary">
              {copy.emptyHint}
            </Text>
            <Button
              label={copy.resetSearch}
              variant="secondary"
              size="sm"
              onClick={() => onQueryChange("")}
            />
          </VStack>
        ) : null}
      </VStack>

      {/* 1. Multi-column grid: 5 columns at 1440, 4 at 1024, 2 at 390 */}
      <VStack
        as="section"
        className="site-recipes-grid-section"
        data-ref-section="1"
        aria-label={copy.gridLabel}
      >
        <VStack as="ul" className="site-recipes-grid-list" data-ref-grid>
          {ordered.map((recipe, index) => {
            const matched = !searching || matchIds.has(recipe.id);
            return (
              <VStack
                as="li"
                key={recipe.id}
                className="site-recipes-grid-item"
              >
                <RecipeCard
                  recipe={recipe}
                  lang={lang}
                  copy={copy}
                  variant="grid"
                  matched={matched}
                  searching={searching}
                  priority={index < 2}
                />
              </VStack>
            );
          })}
        </VStack>
      </VStack>

      {/* 2. Closing band (server-rendered slot) */}
      {closingBand}
    </VStack>
  );
}
