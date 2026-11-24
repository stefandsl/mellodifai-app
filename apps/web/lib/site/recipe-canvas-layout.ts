import type {
  LocalizedText,
  RecipeFormat,
  RecipeKind,
  RecipeOutput,
  RecipeTarget,
} from "@mellodifai/shared";
import type { CSSProperties } from "react";

// Plain serializable projection passed from the server page to client index components.
// Server-only validation and metadata (zod schemas, inputs, preset, rights) never ship to the browser.
export type RecipeIndexItem = {
  id: string;
  slug: string;
  kind: RecipeKind;
  title: LocalizedText;
  summary: LocalizedText;
  highlights: readonly LocalizedText[];
  genre: string;
  tempo?: { bpm?: number | undefined; feel?: string | undefined } | undefined;
  languages: readonly string[];
  output: RecipeOutput;
  format?: RecipeFormat | undefined;
  featured: boolean;
  media: {
    preview: string;
    startAt: number;
  };
  mediaUrls: {
    cover: string;
    preview: string;
  };
  targets: readonly RecipeTarget[];
};

export const ZOOM_STEPS = [50, 75, 100, 125, 150] as const;
export type ZoomLevel = (typeof ZOOM_STEPS)[number];

export const DEFAULT_ZOOM = 100;
export const MIN_ZOOM = 50;
export const MAX_ZOOM = 150;
export const ZOOM_STEP = 25;
export const ARROW_PAN_STEP = 120;
export const MAX_CANVAS_DOM_CARDS = 20;
export const WHEEL_ZOOM_SENSITIVITY = 400;

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
  recipe: Pick<RecipeIndexItem, "output" | "format">,
): CardSize {
  if (recipe.output === "audio" || !recipe.format) return AUDIO_CARD_SIZE;
  return CARD_SIZE_BY_FORMAT[recipe.format];
}

export function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function stepZoom(current: number, deltaSteps: number): number {
  if (deltaSteps === 0) return clampZoom(current);
  const next =
    deltaSteps > 0
      ? Math.floor(current / ZOOM_STEP + 1e-9) * ZOOM_STEP +
        deltaSteps * ZOOM_STEP
      : Math.ceil(current / ZOOM_STEP - 1e-9) * ZOOM_STEP +
        deltaSteps * ZOOM_STEP;
  return clampZoom(next);
}

export function applyWheelZoom(currentZoom: number, deltaY: number): number {
  return clampZoom(currentZoom * Math.exp(-deltaY / WHEEL_ZOOM_SENSITIVITY));
}

export type CanvasViewState = {
  panX: number;
  panY: number;
  zoom: number;
};

// Changes zoom while keeping the world point under (anchorRelX, anchorRelY) fixed,
// where anchorRel* is in screen px relative to the stage centre.
// Passing (0, 0) anchors at the viewport centre (buttons, keys, reset).
export function zoomAroundAnchor(
  view: CanvasViewState,
  nextZoomRaw: number,
  anchorRelX = 0,
  anchorRelY = 0,
): CanvasViewState {
  const nextZoom = clampZoom(nextZoomRaw);
  if (Math.abs(nextZoom - view.zoom) < 1e-9) return view;
  const ratio = nextZoom / view.zoom;
  return {
    panX: anchorRelX - (anchorRelX - view.panX) * ratio,
    panY: anchorRelY - (anchorRelY - view.panY) * ratio,
    zoom: nextZoom,
  };
}

// Hand-tuned organic slots around the central title/search clear zone (offsets in world px
// from the canvas origin at viewport centre).
// - Ring 1 (indices 0..11) surrounds the initial 1440x900 viewport; slots 1, 2, 7, 8 also frame 390x844.
// - Ring 2 (indices 12..15) lies outside the 100% viewport and enters on pan or zoom-out.
// - Ring 3 (indices 16..23) places opposite pairs > 2880 px apart horizontally and > 1800 px
//   apart vertically so at most 20 of 24 cards can ever intersect a 1440x900 viewport at 50% zoom
//   under any pan, ensuring virtualization never drops an on-screen card while staying <= 20 DOM cards.
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
  [-960, -220],
  [960, -200],
  // Ring 2: off-screen at 1440x900 (100% zoom), discovered by panning or zooming out
  [-980, 210],
  [980, 220],
  [-540, -680],
  [540, -670],
  // Ring 3: outer pairs spaced beyond a 50%-zoom 1440x900 window (2880x1800 world px)
  [-460, -1180],
  [460, -1180],
  [-460, 1180],
  [460, 1180],
  [-1780, -420],
  [-1780, 420],
  [1780, -420],
  [1780, 420],
];

function slotPosition(index: number): readonly [number, number] {
  const fixed = WORLD_SLOTS[index];
  if (fixed) return fixed;
  const ring = Math.floor((index - WORLD_SLOTS.length) / 8) + 4;
  const angle = (((index - WORLD_SLOTS.length) % 8) / 8) * Math.PI * 2 + 0.35;
  const rx = 560 * ring;
  const ry = 400 * ring;
  return [Math.round(Math.cos(angle) * rx), Math.round(Math.sin(angle) * ry)];
}

export type CanvasPlacement = {
  recipe: RecipeIndexItem;
  worldX: number;
  worldY: number;
  width: number;
  height: number;
  slotIndex: number;
};

export function placeCanvasRecipes(
  recipes: readonly RecipeIndexItem[],
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
  offsetX: number;
  offsetY: number;
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
  const offsetX = placement.worldX * scale + view.panX;
  const offsetY = placement.worldY * scale + view.panY;
  return {
    x: view.viewportWidth / 2 + offsetX,
    y: view.viewportHeight / 2 + offsetY,
    offsetX,
    offsetY,
    width: placement.width * scale,
    height: placement.height * scale,
    scale,
  };
}

export function rectIntersectsViewport(
  rect: Pick<CanvasCardRect, "x" | "y" | "width" | "height">,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  return (
    rect.x + rect.width >= 0 &&
    rect.x <= viewportWidth &&
    rect.y + rect.height >= 0 &&
    rect.y <= viewportHeight
  );
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

  type Candidate = {
    card: VisibleCanvasCard;
    distSq: number;
  };

  const inViewport: Candidate[] = [];
  const overscanOnly: Candidate[] = [];

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
    const entry: Candidate = {
      card: { ...placement, rect, matched },
      distSq: dx * dx + dy * dy,
    };

    if (rectIntersectsViewport(rect, viewportWidth, viewportHeight)) {
      inViewport.push(entry);
    } else {
      overscanOnly.push(entry);
    }
  }

  const compareCandidates = (a: Candidate, b: Candidate) => {
    if (matchIds !== null && a.card.matched !== b.card.matched) {
      return a.card.matched ? -1 : 1;
    }
    return a.distSq - b.distSq;
  };

  inViewport.sort(compareCandidates);
  overscanOnly.sort(compareCandidates);

  // Never drop a card that intersects the viewport. The DOM cap only limits off-screen overscan cards.
  const overscanBudget = Math.max(0, maxCards - inViewport.length);
  return [
    ...inViewport.map((c) => c.card),
    ...overscanOnly.slice(0, overscanBudget).map((c) => c.card),
  ];
}

// Unitless custom properties consumed by recipes.css. --rc-x/--rc-y are offsets from the
// stage centre (top: 50%; left: 50%), so first paint never depends on measured viewport size.
export function canvasCardStyle(card: VisibleCanvasCard): CSSProperties {
  return {
    "--rc-x": card.rect.offsetX,
    "--rc-y": card.rect.offsetY,
    "--rc-w": card.width,
    "--rc-h": card.height,
    "--rc-scale": card.rect.scale,
  } as CSSProperties;
}

export function gridAspectClass(
  recipe: Pick<RecipeIndexItem, "output" | "format">,
): string {
  if (recipe.output === "audio" || !recipe.format) {
    return "site-recipe-card__media--square";
  }
  if (recipe.format === "16:9") return "site-recipe-card__media--wide";
  if (recipe.format === "9:16") return "site-recipe-card__media--tall";
  if (recipe.format === "4:5") return "site-recipe-card__media--portrait";
  return "site-recipe-card__media--square";
}
