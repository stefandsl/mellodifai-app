"use client";

import { HStack } from "@astryxdesign/core/HStack";
import { Link } from "@astryxdesign/core/Link";
import { searchRecipesLocal } from "@mellodifai/shared";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import type { LoadedRecipe } from "@/lib/site/recipes";
import { RecipeCanvas } from "./recipe-canvas";
import { RecipeGrid } from "./recipe-grid";

export type RecipesViewMode = "canvas" | "grid";

// Coordinates canvas and grid views over the same server-embedded recipe list.
// Search runs 100% locally via searchRecipesLocal (zero network requests).
// View switch links work natively without JavaScript (/recipes and /recipes?view=grid),
// and update the URL via history.replaceState on client-side clicks so reloads keep the view.
export function RecipesIndex({
  recipes,
  initialView,
  fixtureParam,
  lang,
  copy,
  closingBand,
}: {
  recipes: readonly LoadedRecipe[];
  initialView: RecipesViewMode;
  fixtureParam?: string;
  lang: SiteLang;
  copy: SiteCopy["recipes"];
  closingBand: ReactNode;
}) {
  const [view, setView] = useState<RecipesViewMode>(initialView);
  const [query, setQuery] = useState("");

  const matchIds = useMemo<ReadonlySet<string> | null>(() => {
    const trimmed = query.trim();
    if (!trimmed) return null;
    const result = searchRecipesLocal(recipes, trimmed, lang);
    return new Set(result.matches.map((item) => item.id));
  }, [recipes, query, lang]);

  const buildViewHref = useCallback(
    (targetView: RecipesViewMode) => {
      const params = new URLSearchParams();
      if (targetView === "grid") params.set("view", "grid");
      if (fixtureParam) params.set("fixture", fixtureParam);
      const qs = params.toString();
      return qs ? `/recipes?${qs}` : "/recipes";
    },
    [fixtureParam],
  );

  const switchView = useCallback(
    (
      targetView: RecipesViewMode,
      event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
    ) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      if (targetView !== view) {
        setView(targetView);
        window.history.replaceState(null, "", buildViewHref(targetView));
        window.scrollTo(0, 0);
      }
    },
    [view, buildViewHref],
  );

  return (
    <>
      {view === "grid" ? (
        <RecipeGrid
          recipes={recipes}
          matchIds={matchIds}
          query={query}
          onQueryChange={setQuery}
          lang={lang}
          copy={copy}
          closingBand={closingBand}
        />
      ) : (
        <RecipeCanvas
          recipes={recipes}
          matchIds={matchIds}
          query={query}
          onQueryChange={setQuery}
          lang={lang}
          copy={copy}
        />
      )}

      {/* Fixed view switch (bottom centre) */}
      <HStack
        role="group"
        aria-label={copy.viewLabel}
        align="center"
        className="site-recipes-switch"
        data-canvas-ui="true"
        data-recipes-switch="true"
      >
        <Link
          href={buildViewHref("canvas")}
          color="inherit"
          aria-current={view === "canvas" ? "page" : undefined}
          className="site-recipes-switch__item"
          onClick={(event) => switchView("canvas", event)}
        >
          {copy.viewCanvas}
        </Link>
        <Link
          href={buildViewHref("grid")}
          color="inherit"
          aria-current={view === "grid" ? "page" : undefined}
          className="site-recipes-switch__item"
          onClick={(event) => switchView("grid", event)}
        >
          {copy.viewGrid}
        </Link>
      </HStack>
    </>
  );
}
