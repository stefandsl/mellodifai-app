"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Image from "next/image";
import type { CSSProperties } from "react";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import { recipeHref, recipeStartHref } from "@/lib/site/nav";
import {
  CANVAS_IMAGE_SIZES,
  GRID_IMAGE_SIZES,
  gridAspectClass,
} from "@/lib/site/recipe-canvas-layout";
import type { LoadedRecipe } from "@/lib/site/recipes";

export type RecipeCardProps = {
  recipe: LoadedRecipe;
  lang: SiteLang;
  copy: SiteCopy["recipes"];
  variant: "canvas" | "grid";
  matched?: boolean;
  searching?: boolean;
  playPreview?: boolean;
  priority?: boolean;
  cardStyle?: CSSProperties;
  onActivate?: (recipe: LoadedRecipe | null) => void;
};

export function RecipeCard({
  recipe,
  lang,
  copy,
  variant,
  matched = true,
  searching = false,
  playPreview = false,
  priority = false,
  cardStyle,
  onActivate,
}: RecipeCardProps) {
  const title = recipe.title[lang];
  const summary = recipe.summary[lang];
  const kindLabel = copy.kinds[recipe.kind];
  const detailUrl = recipeHref(recipe.slug);
  const startUrl = recipeStartHref(recipe.slug);
  const isVideoPreview =
    playPreview &&
    variant === "canvas" &&
    recipe.media.preview.endsWith(".mp4");

  const frameClass =
    variant === "grid"
      ? `site-recipe-card__frame ${gridAspectClass(recipe)}`
      : "site-recipe-card__frame";

  return (
    <article
      className={`site-recipe-card site-recipe-card--${variant}`}
      style={cardStyle}
      data-recipe-card={variant}
      data-recipe-slug={recipe.slug}
      data-match={matched ? "true" : "false"}
      data-searching={searching ? "true" : "false"}
      onMouseEnter={onActivate ? () => onActivate(recipe) : undefined}
      onMouseLeave={onActivate ? () => onActivate(null) : undefined}
      onFocus={onActivate ? () => onActivate(recipe) : undefined}
      onBlur={onActivate ? () => onActivate(null) : undefined}
    >
      <VStack className={frameClass}>
        <Image
          src={recipe.mediaUrls.cover}
          alt={title}
          fill
          unoptimized
          sizes={variant === "canvas" ? CANVAS_IMAGE_SIZES : GRID_IMAGE_SIZES}
          priority={priority}
          fetchPriority={priority ? "high" : undefined}
          draggable={false}
          className="site-recipe-card__img"
        />
        {isVideoPreview ? (
          <video
            className="site-recipe-card__video"
            src={`${recipe.mediaUrls.preview}#t=${recipe.media.startAt}`}
            muted
            loop
            playsInline
            autoPlay
            preload="none"
            tabIndex={-1}
            onCanPlay={(event) => {
              event.currentTarget.setAttribute("data-ready", "true");
            }}
          />
        ) : null}

        {variant === "canvas" ? (
          <VStack className="site-recipe-card__overlay">
            <VStack gap={0.5}>
              <Link
                href={detailUrl}
                color="inherit"
                draggable={false}
                className="site-recipe-card__link"
              >
                <Text weight="medium" maxLines={1}>
                  {title}
                </Text>
              </Link>
              <Text type="supporting" color="secondary" maxLines={1}>
                {kindLabel}
              </Text>
            </VStack>
            <HStack>
              <Button
                label={copy.openAction}
                href={startUrl}
                variant="secondary"
                size="sm"
                className="site-recipe-card__action site-button--inverted"
              />
            </HStack>
          </VStack>
        ) : (
          <VStack className="site-recipe-card__grid-action">
            <Button
              label={copy.openAction}
              href={startUrl}
              variant="secondary"
              size="sm"
              className="site-button--inverted"
            />
          </VStack>
        )}
      </VStack>

      {variant === "grid" ? (
        <VStack className="site-recipe-card__meta">
          <Link
            href={detailUrl}
            color="inherit"
            className="site-recipe-card__link"
          >
            <Text weight="medium" maxLines={1}>
              {title}
            </Text>
          </Link>
          <Text type="supporting" color="secondary" maxLines={1}>
            {kindLabel}
          </Text>
          <Text type="supporting" color="secondary" maxLines={2}>
            {summary}
          </Text>
        </VStack>
      ) : null}
    </article>
  );
}
