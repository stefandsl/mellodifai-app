"use client";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import {
  ARROW_PAN_STEP,
  canvasCardStyle,
  clampZoom,
  computeVisibleCanvasCards,
  DEFAULT_ZOOM,
  MAX_CANVAS_DOM_CARDS,
  MAX_ZOOM,
  MIN_ZOOM,
  placeCanvasRecipes,
  stepZoom,
} from "@/lib/site/recipe-canvas-layout";
import type { LoadedRecipe } from "@/lib/site/recipes";
import { DashGlyph, PlusGlyph } from "./icons";
import { RecipeCard } from "./recipe-card";
import { SearchField } from "./search-field";

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originPanX: number;
  originPanY: number;
  moved: boolean;
};

type PinchState = {
  startDist: number;
  startZoom: number;
};

// Interactive virtualized canvas of song recipes (STUDY.md 4.1 & 4.2).
// - 1:1 mouse and touch drag with zero inertia after release
// - Wheel pan (document scroll stays 0) and Ctrl+wheel / two-finger pinch zoom (50..150%)
// - Keyboard pan (Arrow keys, 120 px) and zoom (+, -, 0) when canvas has focus
// - Virtualized viewport culling capped at <= 20 cards in the DOM at 1440
export function RecipeCanvas({
  recipes,
  matchIds,
  query,
  onQueryChange,
  lang,
  copy,
}: {
  recipes: readonly LoadedRecipe[];
  matchIds: ReadonlySet<string> | null;
  query: string;
  onQueryChange: (next: string) => void;
  lang: SiteLang;
  copy: SiteCopy["recipes"];
}) {
  const stageRef = useRef<HTMLElement>(null);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [hydrated, setHydrated] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [isDragging, setIsDragging] = useState(false);
  const [animateLayout, setAnimateLayout] = useState(false);
  const [activeCard, setActiveCard] = useState<LoadedRecipe | null>(null);
  const [allowVideo, setAllowVideo] = useState(false);

  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const dragRef = useRef<DragState | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const suppressClickRef = useRef(false);

  const useIsomorphicLayoutEffect =
    typeof window !== "undefined" ? useLayoutEffect : useEffect;

  useIsomorphicLayoutEffect(() => {
    const syncViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    syncViewport();
    setHydrated(true);
    window.addEventListener("resize", syncViewport, { passive: true });
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) {
      setAllowVideo(false);
      return;
    }
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => setAllowVideo(true), 1500);
    };
    if (document.readyState === "complete") {
      arm();
    } else {
      window.addEventListener("load", arm, { once: true });
    }
    return () => {
      window.removeEventListener("load", arm);
      window.clearTimeout(timer);
    };
  }, []);

  // Re-centre pan when search changes so matching cards appear in view immediately.
  const prevQueryRef = useRef(query);
  useEffect(() => {
    if (prevQueryRef.current !== query) {
      prevQueryRef.current = query;
      setAnimateLayout(true);
      setPan({ x: 0, y: 0 });
    }
  }, [query]);

  // Native non-passive wheel listener: wheel pans 1:1, Ctrl+wheel zooms clamped 50..150%.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        setAnimateLayout(true);
        const magnitude = Math.abs(event.deltaY) >= 200 ? 2 : 1;
        const dir = event.deltaY < 0 ? magnitude : -magnitude;
        setZoom((z) => stepZoom(z, dir));
      } else {
        setAnimateLayout(false);
        setPan((prev) => ({
          x: prev.x - event.deltaX,
          y: prev.y - event.deltaY,
        }));
      }
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const placements = useMemo(
    () =>
      placeCanvasRecipes(recipes, {
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        matchIds,
      }),
    [recipes, viewport.width, viewport.height, matchIds],
  );

  const visibleCards = useMemo(
    () =>
      computeVisibleCanvasCards({
        placements,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        panX: pan.x,
        panY: pan.y,
        zoom,
        matchIds,
        maxCards: MAX_CANVAS_DOM_CARDS,
      }),
    [placements, viewport.width, viewport.height, pan.x, pan.y, zoom, matchIds],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-canvas-ui='true']")) return;

      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });

      if (pointersRef.current.size === 2) {
        const pts = [...pointersRef.current.values()];
        const p0 = pts[0];
        const p1 = pts[1];
        if (p0 && p1) {
          pinchRef.current = {
            startDist: Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1,
            startZoom: zoomRef.current,
          };
        }
        dragRef.current = null;
        setIsDragging(false);
        return;
      }

      if (pointersRef.current.size === 1) {
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originPanX: panRef.current.x,
          originPanY: panRef.current.y,
          moved: false,
        };
      }
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });

      if (pointersRef.current.size === 2 && pinchRef.current) {
        const pts = [...pointersRef.current.values()];
        const p0 = pts[0];
        const p1 = pts[1];
        if (p0 && p1) {
          const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          const ratio = dist / pinchRef.current.startDist;
          setAnimateLayout(false);
          setZoom(clampZoom(pinchRef.current.startZoom * ratio));
        }
        return;
      }

      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (!drag.moved && Math.hypot(dx, dy) >= 3) {
        drag.moved = true;
        setAnimateLayout(false);
        setIsDragging(true);
        try {
          stageRef.current?.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer events in tests may not have an active browser pointer id.
        }
      }

      if (drag.moved) {
        setPan({
          x: drag.originPanX + dx,
          y: drag.originPanY + dy,
        });
      }
    },
    [],
  );

  const endPointer = useCallback((event: React.PointerEvent<HTMLElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }

    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      if (drag.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        try {
          if (stageRef.current?.hasPointerCapture(event.pointerId)) {
            stageRef.current.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Ignore when pointer capture was not active.
        }
      }
      dragRef.current = null;
      setIsDragging(false);
    }
  }, []);

  const handleClickCapture = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (suppressClickRef.current) {
        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = false;
      }
    },
    [],
  );

  const handleStageKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.closest("[data-canvas-ui='true']")
      ) {
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setAnimateLayout(false);
        setPan((prev) => ({ x: prev.x - ARROW_PAN_STEP, y: prev.y }));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setAnimateLayout(false);
        setPan((prev) => ({ x: prev.x + ARROW_PAN_STEP, y: prev.y }));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setAnimateLayout(false);
        setPan((prev) => ({ x: prev.x, y: prev.y - ARROW_PAN_STEP }));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setAnimateLayout(false);
        setPan((prev) => ({ x: prev.x, y: prev.y + ARROW_PAN_STEP }));
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setAnimateLayout(true);
        setZoom((z) => stepZoom(z, 1));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setAnimateLayout(true);
        setZoom((z) => stepZoom(z, -1));
      } else if (event.key === "0") {
        event.preventDefault();
        setAnimateLayout(true);
        setZoom(DEFAULT_ZOOM);
      }
    },
    [],
  );

  const searching = matchIds !== null;
  const noMatches = searching && matchIds.size === 0;

  return (
    <VStack
      as="section"
      className="site-recipes-canvas-root"
      data-ref-section="0"
      data-recipes-view="canvas"
      aria-labelledby="recipes-title"
    >
      <VStack className="site-mesh site-mesh--sky" aria-hidden="true" />
      <VStack className="site-mesh site-mesh--stage" aria-hidden="true" />

      {/* Interactive pan/zoom canvas */}
      <VStack
        ref={stageRef}
        role="region"
        tabIndex={0}
        aria-label={copy.canvasLabel}
        className="site-recipes-stage"
        data-recipes-canvas-stage="true"
        data-ready={hydrated ? "true" : "false"}
        data-dragging={isDragging ? "true" : "false"}
        data-animate-layout={animateLayout ? "true" : "false"}
        data-zoom={String(zoom)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClickCapture={handleClickCapture}
        onKeyDown={handleStageKeyDown}
      >
        {visibleCards.map((card, index) => (
          <RecipeCard
            key={card.recipe.id}
            recipe={card.recipe}
            lang={lang}
            copy={copy}
            variant="canvas"
            matched={card.matched}
            searching={searching}
            playPreview={allowVideo}
            priority={index < 6}
            cardStyle={canvasCardStyle(card)}
            onActivate={setActiveCard}
          />
        ))}
      </VStack>

      {/* Centred title, subtitle, search field, and empty state */}
      <VStack className="site-recipes-hero">
        <VStack className="site-recipes-hero__panel">
          <Heading level={1} id="recipes-title" className="site-recipes-title">
            {copy.title}
          </Heading>
          <Text
            as="p"
            type="supporting"
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
        </VStack>

        {noMatches ? (
          <VStack
            role="status"
            aria-live="polite"
            className="site-recipes-empty"
            gap={2}
            hAlign="center"
            data-canvas-ui="true"
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

      {/* Caption block (bottom-left on desktop, reveals active card details) */}
      <VStack
        className="site-recipes-caption"
        data-visible={activeCard ? "true" : "false"}
        aria-live="polite"
        gap={1}
      >
        {activeCard ? (
          <>
            <Text weight="medium">{activeCard.title[lang]}</Text>
            <Text type="supporting" color="secondary" maxLines={2}>
              {activeCard.summary[lang]}
            </Text>
          </>
        ) : null}
      </VStack>

      {/* Zoom bar (bottom-right, desktop/tablet) */}
      <HStack
        role="group"
        aria-label={copy.zoomLabel}
        align="center"
        className="site-recipes-zoom"
        data-canvas-ui="true"
        data-recipes-zoom="true"
      >
        <IconButton
          label={copy.zoomOut}
          icon={<Icon icon={DashGlyph} size="sm" color="inherit" />}
          variant="ghost"
          size="sm"
          isDisabled={zoom <= MIN_ZOOM}
          onClick={() => {
            setAnimateLayout(true);
            setZoom((z) => stepZoom(z, -1));
          }}
        />
        <Button
          label={copy.zoomReset}
          variant="ghost"
          size="sm"
          className="site-recipes-zoom__value"
          onClick={() => {
            setAnimateLayout(true);
            setZoom(DEFAULT_ZOOM);
          }}
        >
          {`${zoom}%`}
        </Button>
        <IconButton
          label={copy.zoomIn}
          icon={<Icon icon={PlusGlyph} size="sm" color="inherit" />}
          variant="ghost"
          size="sm"
          isDisabled={zoom >= MAX_ZOOM}
          onClick={() => {
            setAnimateLayout(true);
            setZoom((z) => stepZoom(z, 1));
          }}
        />
      </HStack>
    </VStack>
  );
}
