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
  applyWheelZoom,
  type CanvasViewState,
  canvasCardStyle,
  clampZoom,
  computeVisibleCanvasCards,
  DEFAULT_ZOOM,
  MAX_CANVAS_DOM_CARDS,
  MAX_ZOOM,
  MIN_ZOOM,
  placeCanvasRecipes,
  type RecipeIndexItem,
  stepZoom,
  zoomAroundAnchor,
} from "@/lib/site/recipe-canvas-layout";
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
  startPanX: number;
  startPanY: number;
  startAnchorRelX: number;
  startAnchorRelY: number;
};

// Interactive virtualized canvas of song recipes (STUDY.md 4.1 & 4.2).
// - 1:1 mouse and touch drag with zero inertia after release
// - Wheel pan (document scroll stays 0) and pointer-anchored Ctrl+wheel / pinch zoom (50..150%)
// - Keyboard pan (Arrow keys, 120 px) and centre-anchored zoom (+, -, 0) when canvas has focus
// - Viewport-centred CSS layout (no jump at hydration, works with JavaScript disabled)
// - Virtualized culling that never drops an on-screen card and caps overscan at <= 20 DOM cards at 1440
export function RecipeCanvas({
  recipes,
  matchIds,
  query,
  onQueryChange,
  lang,
  copy,
}: {
  recipes: readonly RecipeIndexItem[];
  matchIds: ReadonlySet<string> | null;
  query: string;
  onQueryChange: (next: string) => void;
  lang: SiteLang;
  copy: SiteCopy["recipes"];
}) {
  const stageRef = useRef<HTMLElement>(null);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<CanvasViewState>({
    panX: 0,
    panY: 0,
    zoom: DEFAULT_ZOOM,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [animateLayout, setAnimateLayout] = useState(false);
  const [activeCard, setActiveCard] = useState<RecipeIndexItem | null>(null);
  const [allowVideo, setAllowVideo] = useState(false);

  const viewRef = useRef(view);
  viewRef.current = view;

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
      setView((prev) => ({ ...prev, panX: 0, panY: 0 }));
    }
  }, [query]);

  // Native non-passive wheel listener: wheel pans 1:1; Ctrl+wheel zooms continuously around pointer.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const pixelDeltaY =
          event.deltaMode === 1
            ? event.deltaY * 16
            : event.deltaMode === 2
              ? event.deltaY * 800
              : event.deltaY;
        const rect = stage.getBoundingClientRect();
        const anchorRelX = event.clientX - (rect.left + rect.width / 2);
        const anchorRelY = event.clientY - (rect.top + rect.height / 2);
        setAnimateLayout(false);
        setView((prev) =>
          zoomAroundAnchor(
            prev,
            applyWheelZoom(prev.zoom, pixelDeltaY),
            anchorRelX,
            anchorRelY,
          ),
        );
      } else {
        setAnimateLayout(false);
        setView((prev) => ({
          ...prev,
          panX: prev.panX - event.deltaX,
          panY: prev.panY - event.deltaY,
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
        panX: view.panX,
        panY: view.panY,
        zoom: view.zoom,
        matchIds,
        maxCards: MAX_CANVAS_DOM_CARDS,
      }),
    [
      placements,
      viewport.width,
      viewport.height,
      view.panX,
      view.panY,
      view.zoom,
      matchIds,
    ],
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
          const rect = stageRef.current?.getBoundingClientRect();
          const midX = (p0.x + p1.x) / 2;
          const midY = (p0.y + p1.y) / 2;
          const startAnchorRelX = rect
            ? midX - (rect.left + rect.width / 2)
            : 0;
          const startAnchorRelY = rect
            ? midY - (rect.top + rect.height / 2)
            : 0;
          pinchRef.current = {
            startDist: Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1,
            startZoom: viewRef.current.zoom,
            startPanX: viewRef.current.panX,
            startPanY: viewRef.current.panY,
            startAnchorRelX,
            startAnchorRelY,
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
          originPanX: viewRef.current.panX,
          originPanY: viewRef.current.panY,
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
          const pinch = pinchRef.current;
          const rect = stageRef.current?.getBoundingClientRect();
          const midX = (p0.x + p1.x) / 2;
          const midY = (p0.y + p1.y) / 2;
          const curRelX = rect ? midX - (rect.left + rect.width / 2) : 0;
          const curRelY = rect ? midY - (rect.top + rect.height / 2) : 0;
          const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          const ratio = dist / pinch.startDist;
          const nextZoom = clampZoom(pinch.startZoom * ratio);
          const startScale = pinch.startZoom / 100;
          const nextScale = nextZoom / 100;
          const worldMidX =
            (pinch.startAnchorRelX - pinch.startPanX) / startScale;
          const worldMidY =
            (pinch.startAnchorRelY - pinch.startPanY) / startScale;
          setAnimateLayout(false);
          setView({
            panX: curRelX - worldMidX * nextScale,
            panY: curRelY - worldMidY * nextScale,
            zoom: nextZoom,
          });
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
        setView((prev) => ({
          ...prev,
          panX: drag.originPanX + dx,
          panY: drag.originPanY + dy,
        }));
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
        setView((prev) => ({ ...prev, panX: prev.panX - ARROW_PAN_STEP }));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setAnimateLayout(false);
        setView((prev) => ({ ...prev, panX: prev.panX + ARROW_PAN_STEP }));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setAnimateLayout(false);
        setView((prev) => ({ ...prev, panY: prev.panY - ARROW_PAN_STEP }));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setAnimateLayout(false);
        setView((prev) => ({ ...prev, panY: prev.panY + ARROW_PAN_STEP }));
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setAnimateLayout(true);
        setView((prev) => zoomAroundAnchor(prev, stepZoom(prev.zoom, 1), 0, 0));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setAnimateLayout(true);
        setView((prev) =>
          zoomAroundAnchor(prev, stepZoom(prev.zoom, -1), 0, 0),
        );
      } else if (event.key === "0") {
        event.preventDefault();
        setAnimateLayout(true);
        setView((prev) => zoomAroundAnchor(prev, DEFAULT_ZOOM, 0, 0));
      }
    },
    [],
  );

  const displayZoom = Math.round(view.zoom);
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
        data-zoom={String(displayZoom)}
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
          isDisabled={view.zoom <= MIN_ZOOM + 0.01}
          onClick={() => {
            setAnimateLayout(true);
            setView((prev) =>
              zoomAroundAnchor(prev, stepZoom(prev.zoom, -1), 0, 0),
            );
          }}
        />
        <Button
          label={copy.zoomReset}
          variant="ghost"
          size="sm"
          className="site-recipes-zoom__value"
          onClick={() => {
            setAnimateLayout(true);
            setView((prev) => zoomAroundAnchor(prev, DEFAULT_ZOOM, 0, 0));
          }}
        >
          {`${displayZoom}%`}
        </Button>
        <IconButton
          label={copy.zoomIn}
          icon={<Icon icon={PlusGlyph} size="sm" color="inherit" />}
          variant="ghost"
          size="sm"
          isDisabled={view.zoom >= MAX_ZOOM - 0.01}
          onClick={() => {
            setAnimateLayout(true);
            setView((prev) =>
              zoomAroundAnchor(prev, stepZoom(prev.zoom, 1), 0, 0),
            );
          }}
        />
      </HStack>
    </VStack>
  );
}
