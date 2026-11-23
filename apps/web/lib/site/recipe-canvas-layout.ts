import type { RecipeFormat } from "@mellodifai/shared";
import type { CSSProperties } from "react";
import type { LoadedRecipe } from "./recipes";

export const ZOOM_STEPS = [50, 75, 100, 125, 150] as const;
export type ZoomLevel = (typeof ZOOM_STEPS)[number];

export const DEFAULT_ZOOM = 100;
export const MIN_ZOOM = 50;
export const MAX_ZOOM = 150;
export const ZOOM_STEP = 25;
export const ARROW_PAN_STEP = 120;
export const MAX_CANVAS_DOM_CARDS = 20;

export const CANVAS_IMAGE_SIZES = "260px";
export const GRID_IMAGE_SIZES =
  "(max-width: 47.9375em) 48vw, (max-width: 79.9375em) 24vw, 19vw";

export type CardSize = { width: number; height: number };

const CARD_SIZE_BY_FORMAT: Record<RecipeFormat, CardSize> = {
  "16:9": { width: 260, height: 146 },
  "9:16": { width: 168, height: 299 },
  "4:5": { width: 216, height: 270 },
  "1:1": { width: 216, height: 216 },
};

const AUDIO_CARD_SIZE: CardSize = { width: 216, height: 216 };

export function baseCardSize(
  recipe: Pick<LoadedRecipe, "output" | "format">,
): CardSize {
  if (recipe.output === "audio" || !recipe.format) return AUDIO_CARD_SIZE;
  return CARD_SIZE_BY_FORMAT[recipe.format];
}

export function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value)));
}

export function stepZoom(current: number, deltaSteps: number): number {
  const snapped = Math.round(current / ZOOM_STEP) * ZOOM_STEP;
  return clampZoom(snapped + deltaSteps * ZOOM_STEP);
}

// Hand-tuned organic slots around the central title/search clear zone (offsets in world px
// from the canvas origin at viewport centre). Ring 1 (indices 0..11) surrounds the initial
// 1440x900 viewport; Ring 2 (indices 12..23) lies outside the initial viewport so panning
// reveals new cards and virtualization stays well below the 20-card DOM cap.
const WORLD_SLOTS: readonly (readonly [number, number])[] = [
  // Ring 1: visible around the centred title + search box at 1440x900
  [-570, -340],
  [-210, -370],
  [210, -360],
  [560, -330],
  [-610, -40],
  [590, -20],
  [-580, 270],
  [-200, 290],
  [210, 285],
  [570, 260],
  [-920, -210],
  [920, -180],
  // Ring 2: off-screen at 1440x900 (100% zoom), discovered by panning or zooming out
  [-950, 170],
  [940, 190],
  [-480, -680],
  [0, -700],
  [490, -670],
  [-470, 650],
  [10, 670],
  [480, 640],
  [-1280, -360],
  [1280, -340],
  [-1260, 320],
  [1260, 340],
];

function slotPosition(index: number): readonly [number, number] {
  const fixed = WORLD_SLOTS[index];
  if (fixed) return fixed;
  const ring = Math.floor((index - WORLD_SLOTS.length) / 8) + 3;
  const angle = (((index - WORLD_SLOTS.length) % 8) / 8) * Math.PI * 2 + 0.35;
  const rx = 540 * ring;
  const ry = 380 * ring;
  return [Math.round(Math.cos(angle) * rx), Math.round(Math.sin(angle) * ry)];
}

export type CanvasPlacement = {
  recipe: LoadedRecipe;
  worldX: number;
  worldY: number;
  width: number;
  height: number;
  slotIndex: number;
};

export function placeCanvasRecipes(
  recipes: readonly LoadedRecipe[],
  options: {
    viewportWidth: number;
    viewportHeight: number;
    matchIds?: ReadonlySet<string> | null;
  },
): CanvasPlacement[] {
  const { matchIds } = options;
  const ordered =
    matchIds && matchIds.size > 0
      ? [
          ...recipes.filter((r) => matchIds.has(r.id)),
          ...recipes.filter((r) => !matchIds.has(r.id)),
        ]
      : recipes;

  return ordered.map((recipe, slotIndex) => {
    const size = baseCardSize(recipe);
    const [cx, cy] = slotPosition(slotIndex);
    return {
      recipe,
      worldX: Math.round(cx - size.width / 2),
      worldY: Math.round(cy - size.height / 2),
      width: size.width,
      height: size.height,
      slotIndex,
    };
  });
}

export type CanvasCardRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export function canvasCardRect(
  placement: CanvasPlacement,
  view: {
    viewportWidth: number;
    viewportHeight: number;
    panX: number;
    panY: number;
    zoom: number;
  },
): CanvasCardRect {
  const scale = view.zoom / 100;
  const x = view.viewportWidth / 2 + placement.worldX * scale + view.panX;
  const y = view.viewportHeight / 2 + placement.worldY * scale + view.panY;
  return {
    x,
    y,
    width: placement.width * scale,
    height: placement.height * scale,
    scale,
  };
}

export type VisibleCanvasCard = CanvasPlacement & {
  rect: CanvasCardRect;
  matched: boolean;
};

export function computeVisibleCanvasCards(input: {
  placements: readonly CanvasPlacement[];
  viewportWidth: number;
  viewportHeight: number;
  panX: number;
  panY: number;
  zoom: number;
  matchIds?: ReadonlySet<string> | null;
  overscan?: number;
  maxCards?: number;
}): VisibleCanvasCard[] {
  const {
    placements,
    viewportWidth,
    viewportHeight,
    panX,
    panY,
    zoom,
    matchIds = null,
    overscan = 120,
    maxCards = MAX_CANVAS_DOM_CARDS,
  } = input;

  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;
  const minX = -overscan;
  const minY = -overscan;
  const maxX = viewportWidth + overscan;
  const maxY = viewportHeight + overscan;

  const candidates: Array<{
    card: VisibleCanvasCard;
    distSq: number;
  }> = [];

  for (const placement of placements) {
    const rect = canvasCardRect(placement, {
      viewportWidth,
      viewportHeight,
      panX,
      panY,
      zoom,
    });
    const inBounds =
      rect.x + rect.width >= minX &&
      rect.x <= maxX &&
      rect.y + rect.height >= minY &&
      rect.y <= maxY;
    if (!inBounds) continue;

    const matched = matchIds === null || matchIds.has(placement.recipe.id);
    const cardCenterX = rect.x + rect.width / 2;
    const cardCenterY = rect.y + rect.height / 2;
    const dx = cardCenterX - centerX;
    const dy = cardCenterY - centerY;
    candidates.push({
      card: { ...placement, rect, matched },
      distSq: dx * dx + dy * dy,
    });
  }

  candidates.sort((a, b) => {
    if (matchIds !== null && a.card.matched !== b.card.matched) {
      return a.card.matched ? -1 : 1;
    }
    return a.distSq - b.distSq;
  });

  return candidates.slice(0, maxCards).map((c) => c.card);
}

// Unitless custom properties consumed by recipes.css via calc(var(--rc-*) * var(--site-pixel)).
export function canvasCardStyle(card: VisibleCanvasCard): CSSProperties {
  return {
    "--rc-x": card.rect.x,
    "--rc-y": card.rect.y,
    "--rc-w": card.width,
    "--rc-h": card.height,
    "--rc-scale": card.rect.scale,
  } as CSSProperties;
}

export function gridAspectClass(
  recipe: Pick<LoadedRecipe, "output" | "format">,
): string {
  if (recipe.output === "audio" || !recipe.format) {
    return "site-recipe-card__media--square";
  }
  if (recipe.format === "16:9") return "site-recipe-card__media--wide";
  if (recipe.format === "9:16") return "site-recipe-card__media--tall";
  if (recipe.format === "4:5") return "site-recipe-card__media--portrait";
  return "site-recipe-card__media--square";
}
