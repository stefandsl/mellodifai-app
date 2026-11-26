// Vanilla ES module island for /recipes (interactive canvas, local search,
// multi-column grid view switch, and shared site shell). Zero React or Zod.

import { searchRecipesLocal } from "@mellodifai/shared/recipes/search";
import type { SiteCopy, SiteLang } from "../copy";
import { recipeHref, recipeStartHref } from "../nav";
import {
  ARROW_PAN_STEP,
  applyWheelZoom,
  type CanvasViewState,
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
} from "../recipe-canvas-layout";
import { initShell } from "./shell";

type RecipesViewMode = "canvas" | "grid";

type RecipesPayload = {
  recipes: RecipeIndexItem[];
  lang: SiteLang;
  initialView: RecipesViewMode;
  fixtureParam?: string;
  copy: SiteCopy["recipes"];
};

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function readPayload(): RecipesPayload | null {
  const el = document.getElementById("site-recipes-data");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as RecipesPayload;
  } catch {
    return null;
  }
}

function mountRecipesPage(): void {
  const payload = readPayload();
  if (!payload) return;

  const { recipes, lang, fixtureParam, copy } = payload;
  const mainEl = document.getElementById("main");
  const switchEl = document.querySelector<HTMLElement>(
    '[data-recipes-switch="true"]',
  );
  if (!mainEl || !switchEl) return;
  const main: HTMLElement = mainEl;
  const switchGroup: HTMLElement = switchEl;

  const emptyTpl = document.querySelector<HTMLTemplateElement>(
    'template[data-recipes-empty-tpl="true"]',
  );
  const clearTpl = document.querySelector<HTMLTemplateElement>(
    'template[data-recipes-clear-tpl="true"]',
  );
  const captionTpl = document.querySelector<HTMLTemplateElement>(
    'template[data-recipes-caption-tpl="true"]',
  );

  const bySlug = new Map<string, RecipeIndexItem>();
  for (const r of recipes) bySlug.set(r.slug, r);

  let currentView: RecipesViewMode = payload.initialView;
  let query = "";
  let matchIds: ReadonlySet<string> | null = null;
  let activeCleanup: (() => void) | null = null;
  let activeSearchUpdate: ((q: string) => void) | null = null;
  let activeInput: HTMLInputElement | null = null;

  const viewCache = new Map<RecipesViewMode, HTMLElement>();
  const initialRoot = main.querySelector<HTMLElement>("[data-recipes-view]");
  if (initialRoot) {
    viewCache.set(currentView, initialRoot);
  }

  function buildViewHref(targetView: RecipesViewMode): string {
    const params = new URLSearchParams();
    if (targetView === "grid") params.set("view", "grid");
    if (fixtureParam) params.set("fixture", fixtureParam);
    const qs = params.toString();
    return qs ? `/recipes?${qs}` : "/recipes";
  }

  function computeMatchIds(q: string): ReadonlySet<string> | null {
    const trimmed = q.trim();
    if (!trimmed) return null;
    const result = searchRecipesLocal(recipes, trimmed, lang);
    return new Set(result.matches.map((item) => item.id));
  }

  function setQuery(next: string): void {
    if (next === query) return;
    query = next;
    matchIds = computeMatchIds(query);
    if (activeSearchUpdate) activeSearchUpdate(query);
  }

  function createEmptyNode(): HTMLElement | null {
    if (!emptyTpl) return null;
    const frag = emptyTpl.content.cloneNode(true) as DocumentFragment;
    const node = frag.firstElementChild as HTMLElement | null;
    if (!node) return null;
    const resetBtn = node.querySelector<HTMLButtonElement>("button");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        setQuery("");
        activeInput?.focus();
      });
    }
    return node;
  }

  function bindSearchField(root: HTMLElement): () => void {
    const container = root.querySelector<HTMLElement>(".site-recipes-search");
    const input = container?.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    const endSlot = container?.querySelector<HTMLElement>(
      ".site-recipes-search__end",
    );
    const kbd = endSlot?.querySelector<HTMLElement>(
      ".site-recipes-search__kbd",
    );
    if (!input || !endSlot) return () => {};

    activeInput = input;
    if (query === "" && input.value !== "") {
      query = input.value;
      matchIds = computeMatchIds(query);
    } else {
      input.value = query;
    }

    let clearBtn: HTMLButtonElement | null = null;
    const syncEndSlot = () => {
      if (input.value) {
        if (kbd) kbd.hidden = true;
        if (!clearBtn && clearTpl) {
          const frag = clearTpl.content.cloneNode(true) as DocumentFragment;
          clearBtn = frag.firstElementChild as HTMLButtonElement | null;
          if (clearBtn) {
            clearBtn.addEventListener("click", () => {
              setQuery("");
              input.focus();
            });
            endSlot.appendChild(clearBtn);
          }
        }
        if (clearBtn) clearBtn.hidden = false;
      } else {
        if (clearBtn) clearBtn.hidden = true;
        if (kbd) kbd.hidden = false;
      }
    };

    const onInput = () => {
      setQuery(input.value);
      syncEndSlot();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (query) setQuery("");
        input.blur();
      }
    };

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeyDown);
    syncEndSlot();

    return () => {
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      if (activeInput === input) activeInput = null;
    };
  }

  // Global `/` and Ctrl/Cmd+K shortcut (never intercepts Ctrl/Cmd+F).
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (isEditableTarget(event.target)) return;
    const isSlash =
      event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
    const isModK =
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "k";
    if (isSlash || isModK) {
      event.preventDefault();
      activeInput?.focus();
    }
  });

  function mountCanvas(root: HTMLElement): () => void {
    const stageEl = root.querySelector<HTMLElement>(
      '[data-recipes-canvas-stage="true"]',
    );
    const hero = root.querySelector<HTMLElement>(".site-recipes-hero");
    const caption = root.querySelector<HTMLElement>(".site-recipes-caption");
    const zoomBar = root.querySelector<HTMLElement>(
      '[data-recipes-zoom="true"]',
    );
    if (!stageEl) return () => {};
    const stage: HTMLElement = stageEl;

    let viewport = { width: window.innerWidth, height: window.innerHeight };
    let view: CanvasViewState = { panX: 0, panY: 0, zoom: DEFAULT_ZOOM };
    let isDragging = false;
    let animateLayout = false;
    let allowVideo = false;
    let drag: DragState | null = null;
    let pinch: PinchState | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let suppressClick = false;
    let emptyNode: HTMLElement | null = null;

    // Seed card pool from SSR cards and capture a clean Astryx template for virtualization.
    const cardPool = new Map<string, HTMLElement>();
    let cardTemplate: HTMLElement | null = null;
    const mountedCards = stage.querySelectorAll<HTMLElement>(
      '[data-recipe-card="canvas"]',
    );
    for (const el of mountedCards) {
      if (!cardTemplate) {
        cardTemplate = el.cloneNode(true) as HTMLElement;
        const tplVid = cardTemplate.querySelector(".site-recipe-card__video");
        if (tplVid) tplVid.remove();
      }
      const slug = el.getAttribute("data-recipe-slug") ?? "";
      const recipe = bySlug.get(slug);
      if (recipe) {
        cardPool.set(recipe.id, el);
        wireCardActivation(el, recipe);
      }
    }

    function setActiveCaption(recipe: RecipeIndexItem | null): void {
      if (!caption) return;
      if (!recipe) {
        caption.setAttribute("data-visible", "false");
        caption.textContent = "";
        return;
      }
      caption.setAttribute("data-visible", "true");
      caption.textContent = "";
      if (captionTpl) {
        const frag = captionTpl.content.cloneNode(true) as DocumentFragment;
        const children = Array.from(frag.children);
        const titleEl = children[0] as HTMLElement | undefined;
        const summaryEl = children[1] as HTMLElement | undefined;
        if (titleEl) titleEl.textContent = recipe.title[lang];
        if (summaryEl) summaryEl.textContent = recipe.summary[lang];
        caption.appendChild(frag);
      } else {
        const t = document.createElement("span");
        t.textContent = recipe.title[lang];
        const s = document.createElement("span");
        s.textContent = recipe.summary[lang];
        caption.append(t, s);
      }
    }

    function wireCardActivation(
      el: HTMLElement,
      recipe: RecipeIndexItem,
    ): void {
      if (el.dataset.activationWired === "true") return;
      el.dataset.activationWired = "true";
      el.addEventListener("mouseenter", () => setActiveCaption(recipe));
      el.addEventListener("mouseleave", () => setActiveCaption(null));
      el.addEventListener("focusin", () => setActiveCaption(recipe));
      el.addEventListener("focusout", () => setActiveCaption(null));
    }

    function getOrCreateCard(recipe: RecipeIndexItem): HTMLElement {
      const existing = cardPool.get(recipe.id);
      if (existing) return existing;
      if (!cardTemplate) {
        const fallback = document.createElement("article");
        fallback.className = "site-recipe-card site-recipe-card--canvas";
        fallback.setAttribute("data-recipe-card", "canvas");
        fallback.setAttribute("data-recipe-slug", recipe.slug);
        cardPool.set(recipe.id, fallback);
        return fallback;
      }
      const el = cardTemplate.cloneNode(true) as HTMLElement;
      delete el.dataset.activationWired;
      el.setAttribute("data-recipe-slug", recipe.slug);

      const title = recipe.title[lang];
      const kindLabel = copy.kinds[recipe.kind];
      const img = el.querySelector<HTMLImageElement>(".site-recipe-card__img");
      if (img) {
        img.src = recipe.mediaUrls.cover;
        img.alt = title;
        img.removeAttribute("fetchpriority");
      }
      const link = el.querySelector<HTMLAnchorElement>(
        ".site-recipe-card__link",
      );
      if (link) {
        link.href = recipeHref(recipe.slug);
        const textNode = link.querySelector("span, p") ?? link;
        textNode.textContent = title;
      }
      const overlay = el.querySelector<HTMLElement>(
        ".site-recipe-card__overlay",
      );
      const kindSpan = overlay?.querySelector(
        ":scope > div > span:last-of-type, :scope > div > p:last-of-type",
      );
      if (kindSpan && kindSpan !== link) {
        kindSpan.textContent = kindLabel;
      }
      const actionLink = el.querySelector<HTMLAnchorElement>(
        ".site-recipe-card__action",
      );
      if (actionLink) {
        actionLink.href = recipeStartHref(recipe.slug);
      }

      wireCardActivation(el, recipe);
      cardPool.set(recipe.id, el);
      return el;
    }

    function ensureVideo(el: HTMLElement, recipe: RecipeIndexItem): void {
      if (!allowVideo || !recipe.media.preview.endsWith(".mp4")) return;
      const frame = el.querySelector<HTMLElement>(".site-recipe-card__frame");
      if (!frame || frame.querySelector(".site-recipe-card__video")) return;
      const video = document.createElement("video");
      video.className = "site-recipe-card__video";
      video.src = `${recipe.mediaUrls.preview}#t=${recipe.media.startAt}`;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.preload = "none";
      video.tabIndex = -1;
      video.addEventListener("canplay", () => {
        video.setAttribute("data-ready", "true");
      });
      const img = frame.querySelector(".site-recipe-card__img");
      if (img?.nextSibling) {
        frame.insertBefore(video, img.nextSibling);
      } else {
        frame.appendChild(video);
      }
    }

    const zoomButtons = zoomBar
      ? Array.from(zoomBar.querySelectorAll<HTMLButtonElement>("button"))
      : [];
    const minusBtn = zoomButtons[0] ?? null;
    const resetBtn = zoomButtons[1] ?? null;
    const resetLabel =
      resetBtn?.querySelector<HTMLElement>("span > span") ?? resetBtn;
    const plusBtn = zoomButtons[2] ?? null;

    function syncEmptyState(): void {
      const noMatches = matchIds !== null && matchIds.size === 0;
      if (noMatches) {
        if (!emptyNode && hero) {
          emptyNode = createEmptyNode();
          if (emptyNode) hero.appendChild(emptyNode);
        }
      } else if (emptyNode) {
        emptyNode.remove();
        emptyNode = null;
      }
    }

    function render(): void {
      const placements = placeCanvasRecipes(recipes, {
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        matchIds,
      });
      const visible = computeVisibleCanvasCards({
        placements,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        panX: view.panX,
        panY: view.panY,
        zoom: view.zoom,
        matchIds,
        maxCards: MAX_CANVAS_DOM_CARDS,
      });

      const displayZoom = Math.round(view.zoom);
      stage.setAttribute("data-ready", "true");
      stage.setAttribute("data-dragging", isDragging ? "true" : "false");
      stage.setAttribute(
        "data-animate-layout",
        animateLayout ? "true" : "false",
      );
      stage.setAttribute("data-zoom", String(displayZoom));

      if (resetLabel) resetLabel.textContent = `${displayZoom}%`;
      if (minusBtn) minusBtn.disabled = view.zoom <= MIN_ZOOM + 0.01;
      if (plusBtn) plusBtn.disabled = view.zoom >= MAX_ZOOM - 0.01;

      const visibleIds = new Set<string>();
      const visibleEls: HTMLElement[] = [];
      const searching = matchIds !== null;

      for (const card of visible) {
        visibleIds.add(card.recipe.id);
        const el = getOrCreateCard(card.recipe);
        el.style.setProperty("--rc-x", String(card.rect.offsetX));
        el.style.setProperty("--rc-y", String(card.rect.offsetY));
        el.style.setProperty("--rc-w", String(card.width));
        el.style.setProperty("--rc-h", String(card.height));
        el.style.setProperty("--rc-scale", String(card.rect.scale));
        el.setAttribute("data-match", card.matched ? "true" : "false");
        el.setAttribute("data-searching", searching ? "true" : "false");
        ensureVideo(el, card.recipe);
        visibleEls.push(el);
      }

      for (const [id, el] of cardPool) {
        if (!visibleIds.has(id) && el.parentElement === stage) {
          el.remove();
        }
      }

      // Keep DOM and tab order aligned with visible placement order without detaching in-order cards.
      let cursor = stage.firstElementChild;
      for (const el of visibleEls) {
        if (el === cursor) {
          cursor = cursor.nextElementSibling;
        } else {
          stage.insertBefore(el, cursor);
        }
      }

      syncEmptyState();
    }

    const onResize = () => {
      viewport = { width: window.innerWidth, height: window.innerHeight };
      render();
    };
    window.addEventListener("resize", onResize, { passive: true });

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
        animateLayout = false;
        view = zoomAroundAnchor(
          view,
          applyWheelZoom(view.zoom, pixelDeltaY),
          anchorRelX,
          anchorRelY,
        );
      } else {
        animateLayout = false;
        view = {
          ...view,
          panX: view.panX - event.deltaX,
          panY: view.panY - event.deltaY,
        };
      }
      render();
    };
    stage.addEventListener("wheel", onWheel, { passive: false });

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-canvas-ui='true']")) return;

      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const p0 = pts[0];
        const p1 = pts[1];
        if (p0 && p1) {
          const rect = stage.getBoundingClientRect();
          const midX = (p0.x + p1.x) / 2;
          const midY = (p0.y + p1.y) / 2;
          pinch = {
            startDist: Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1,
            startZoom: view.zoom,
            startPanX: view.panX,
            startPanY: view.panY,
            startAnchorRelX: midX - (rect.left + rect.width / 2),
            startAnchorRelY: midY - (rect.top + rect.height / 2),
          };
        }
        drag = null;
        isDragging = false;
        render();
        return;
      }

      if (pointers.size === 1) {
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originPanX: view.panX,
          originPanY: view.panY,
          moved: false,
        };
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 2 && pinch) {
        const pts = [...pointers.values()];
        const p0 = pts[0];
        const p1 = pts[1];
        if (p0 && p1) {
          const rect = stage.getBoundingClientRect();
          const midX = (p0.x + p1.x) / 2;
          const midY = (p0.y + p1.y) / 2;
          const curRelX = midX - (rect.left + rect.width / 2);
          const curRelY = midY - (rect.top + rect.height / 2);
          const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          const ratio = dist / pinch.startDist;
          const nextZoom = clampZoom(pinch.startZoom * ratio);
          const startScale = pinch.startZoom / 100;
          const nextScale = nextZoom / 100;
          const worldMidX =
            (pinch.startAnchorRelX - pinch.startPanX) / startScale;
          const worldMidY =
            (pinch.startAnchorRelY - pinch.startPanY) / startScale;
          animateLayout = false;
          view = {
            panX: curRelX - worldMidX * nextScale,
            panY: curRelY - worldMidY * nextScale,
            zoom: nextZoom,
          };
          render();
        }
        return;
      }

      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (!drag.moved && Math.hypot(dx, dy) >= 3) {
        drag.moved = true;
        animateLayout = false;
        isDragging = true;
        try {
          stage.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer events in tests may not have an active pointer id.
        }
      }

      if (drag.moved) {
        view = {
          ...view,
          panX: drag.originPanX + dx,
          panY: drag.originPanY + dy,
        };
        render();
      }
    };

    const onPointerEnd = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;

      if (drag && drag.pointerId === event.pointerId) {
        if (drag.moved) {
          suppressClick = true;
          window.setTimeout(() => {
            suppressClick = false;
          }, 0);
          try {
            if (stage.hasPointerCapture(event.pointerId)) {
              stage.releasePointerCapture(event.pointerId);
            }
          } catch {
            // Ignore when pointer capture was not active.
          }
        }
        drag = null;
        isDragging = false;
        render();
      }
    };

    const onClickCapture = (event: MouseEvent) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
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
        animateLayout = false;
        view = { ...view, panX: view.panX - ARROW_PAN_STEP };
        render();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        animateLayout = false;
        view = { ...view, panX: view.panX + ARROW_PAN_STEP };
        render();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        animateLayout = false;
        view = { ...view, panY: view.panY - ARROW_PAN_STEP };
        render();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        animateLayout = false;
        view = { ...view, panY: view.panY + ARROW_PAN_STEP };
        render();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        animateLayout = true;
        view = zoomAroundAnchor(view, stepZoom(view.zoom, 1), 0, 0);
        render();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        animateLayout = true;
        view = zoomAroundAnchor(view, stepZoom(view.zoom, -1), 0, 0);
        render();
      } else if (event.key === "0") {
        event.preventDefault();
        animateLayout = true;
        view = zoomAroundAnchor(view, DEFAULT_ZOOM, 0, 0);
        render();
      }
    };

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerEnd);
    stage.addEventListener("pointercancel", onPointerEnd);
    stage.addEventListener("click", onClickCapture, true);
    stage.addEventListener("keydown", onKeyDown);

    const onMinus = () => {
      animateLayout = true;
      view = zoomAroundAnchor(view, stepZoom(view.zoom, -1), 0, 0);
      render();
    };
    const onReset = () => {
      animateLayout = true;
      view = zoomAroundAnchor(view, DEFAULT_ZOOM, 0, 0);
      render();
    };
    const onPlus = () => {
      animateLayout = true;
      view = zoomAroundAnchor(view, stepZoom(view.zoom, 1), 0, 0);
      render();
    };
    minusBtn?.addEventListener("click", onMinus);
    resetBtn?.addEventListener("click", onReset);
    plusBtn?.addEventListener("click", onPlus);

    // Delayed video previews (skipped when prefers-reduced-motion: reduce).
    let videoTimer = 0;
    const armVideo = () => {
      videoTimer = window.setTimeout(() => {
        allowVideo = true;
        render();
      }, 1500);
    };
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!reduced) {
      if (document.readyState === "complete") {
        armVideo();
      } else {
        window.addEventListener("load", armVideo, { once: true });
      }
    }

    const unbindSearch = bindSearchField(root);
    activeSearchUpdate = (q: string) => {
      if (activeInput && activeInput.value !== q) {
        activeInput.value = q;
        activeInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      animateLayout = true;
      view = { ...view, panX: 0, panY: 0 };
      render();
    };

    render();

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("load", armVideo);
      window.clearTimeout(videoTimer);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerEnd);
      stage.removeEventListener("pointercancel", onPointerEnd);
      stage.removeEventListener("click", onClickCapture, true);
      stage.removeEventListener("keydown", onKeyDown);
      minusBtn?.removeEventListener("click", onMinus);
      resetBtn?.removeEventListener("click", onReset);
      plusBtn?.removeEventListener("click", onPlus);
      unbindSearch();
      activeSearchUpdate = null;
    };
  }

  function mountGrid(root: HTMLElement): () => void {
    const head = root.querySelector<HTMLElement>(".site-recipes-grid-head");
    const listEl = root.querySelector<HTMLElement>(".site-recipes-grid-list");
    if (!listEl) return () => {};
    const list: HTMLElement = listEl;

    const itemsById = new Map<string, HTMLElement>();
    for (const li of list.querySelectorAll<HTMLElement>(
      ".site-recipes-grid-item",
    )) {
      const card = li.querySelector<HTMLElement>('[data-recipe-card="grid"]');
      const slug = card?.getAttribute("data-recipe-slug") ?? "";
      const recipe = bySlug.get(slug);
      if (recipe) itemsById.set(recipe.id, li);
    }

    let emptyNode: HTMLElement | null = null;

    function renderGrid(): void {
      const activeMatches = matchIds;
      const searching = activeMatches !== null;
      const noMatches = activeMatches !== null && activeMatches.size === 0;
      const ordered =
        activeMatches !== null && activeMatches.size > 0
          ? [
              ...recipes.filter((r) => activeMatches.has(r.id)),
              ...recipes.filter((r) => !activeMatches.has(r.id)),
            ]
          : recipes;

      for (const recipe of ordered) {
        const li = itemsById.get(recipe.id);
        if (!li) continue;
        const card = li.querySelector<HTMLElement>('[data-recipe-card="grid"]');
        const matched = activeMatches === null || activeMatches.has(recipe.id);
        if (card) {
          card.setAttribute("data-match", matched ? "true" : "false");
          card.setAttribute("data-searching", searching ? "true" : "false");
        }
        list.appendChild(li);
      }

      if (noMatches) {
        if (!emptyNode && head) {
          emptyNode = createEmptyNode();
          if (emptyNode) head.appendChild(emptyNode);
        }
      } else if (emptyNode) {
        emptyNode.remove();
        emptyNode = null;
      }
    }

    const unbindSearch = bindSearchField(root);
    activeSearchUpdate = (q: string) => {
      if (activeInput && activeInput.value !== q) {
        activeInput.value = q;
        activeInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      renderGrid();
    };

    renderGrid();

    return () => {
      unbindSearch();
      activeSearchUpdate = null;
    };
  }

  function activateView(view: RecipesViewMode, root: HTMLElement): void {
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }
    currentView = view;
    activeCleanup = view === "grid" ? mountGrid(root) : mountCanvas(root);
  }

  async function switchTo(targetView: RecipesViewMode): Promise<void> {
    if (targetView === currentView) return;
    const targetHref = buildViewHref(targetView);

    let nextRoot = viewCache.get(targetView) ?? null;
    if (!nextRoot) {
      try {
        const res = await fetch(targetHref, {
          headers: { Accept: "text/html" },
        });
        if (!res.ok) {
          window.location.assign(targetHref);
          return;
        }
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const fetched = doc.querySelector<HTMLElement>("[data-recipes-view]");
        if (!fetched) {
          window.location.assign(targetHref);
          return;
        }
        const fetchedStyle = doc.head.querySelector("style");
        if (
          fetchedStyle?.textContent &&
          !document.head.querySelector(
            `style[data-recipes-view-style="${targetView}"]`,
          )
        ) {
          const styleEl = document.createElement("style");
          styleEl.setAttribute("data-recipes-view-style", targetView);
          styleEl.textContent = fetchedStyle.textContent;
          document.head.appendChild(styleEl);
        }
        nextRoot = document.importNode(fetched, true);
        viewCache.set(targetView, nextRoot);
      } catch {
        window.location.assign(targetHref);
        return;
      }
    }

    const existingRoot = main.querySelector<HTMLElement>("[data-recipes-view]");
    if (existingRoot) {
      existingRoot.replaceWith(nextRoot);
    } else {
      main.insertBefore(nextRoot, switchGroup);
    }

    const links = switchGroup.querySelectorAll<HTMLAnchorElement>(
      ".site-recipes-switch__item",
    );
    const canvasLink = links[0];
    const gridLink = links[1];
    if (canvasLink) {
      if (targetView === "canvas")
        canvasLink.setAttribute("aria-current", "page");
      else canvasLink.removeAttribute("aria-current");
    }
    if (gridLink) {
      if (targetView === "grid") gridLink.setAttribute("aria-current", "page");
      else gridLink.removeAttribute("aria-current");
    }

    window.history.replaceState(null, "", targetHref);
    window.scrollTo(0, 0);
    activateView(targetView, nextRoot);
  }

  const switchLinks = switchGroup.querySelectorAll<HTMLAnchorElement>(
    ".site-recipes-switch__item",
  );
  const modes: RecipesViewMode[] = ["canvas", "grid"];
  switchLinks.forEach((link, idx) => {
    const mode = modes[idx];
    if (!mode) return;
    link.addEventListener("click", (event) => {
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
      void switchTo(mode);
    });
  });

  if (initialRoot) {
    activateView(currentView, initialRoot);
  }
}

export function initRecipes(): void {
  initShell();
  mountRecipesPage();
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initRecipes();
}
