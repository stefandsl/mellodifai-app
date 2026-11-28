// Interactive island for /agents:
// - 5-way agent switch with rAF-driven sliding thumb (zero per-frame layout reads, pauses when hidden)
// - URL sync via history.pushState + popstate without reload
// - Copy buttons with screen-reader announcements in the SSR role="status" region
// - Real MCP tool catalog filter + show-more toggle
// - Prompt cloud chip selector + composer bar copy
// - #how-to-connect scroll + shared FAQ accordion
import { AGENTS, type AgentName, parseAgentParam } from "../nav";
import { initFaq } from "./faq";
import { initShell } from "./shell";

export const AGENT_THUMB_DURATION_MS = 220;
const COPY_RESET_MS = 1800;

type AgentStepPayload = {
  title: string;
  line: string;
  copyText?: string;
  copyLabel?: string;
  copyKind?: "mcp" | "cli" | "config";
};

type AgentProfilePayload = {
  id: AgentName;
  name: string;
  heroLineA: string;
  heroLineB: string;
  heroLede: string;
  primaryCtaLabel: string;
  primaryCtaHref: string;
  transportBadge: string;
  mockChat: {
    clientLabel: string;
    userPrompt: string;
    toolName: string;
    toolMeta: string;
    assistantReply: string;
  };
  connectSteps: [AgentStepPayload, AgentStepPayload, AgentStepPayload];
  connectCtaLabel: string;
  connectCtaHref: string;
  faqClientAnswer: string;
};

type AgentsIslandData = {
  activeAgent: AgentName;
  profiles: Record<AgentName, AgentProfilePayload>;
  copy: {
    copyButton: string;
    copiedButton: string;
    copyStatus: string;
    copyFailed: string;
    switchedStatus: string;
  };
};

type RectCache = {
  left: number;
  width: number;
};

type SwitchController = {
  root: HTMLElement;
  variant: string;
  track: HTMLElement | null;
  shell: HTMLElement | null;
  thumb: HTMLElement | null;
  tabs: Map<AgentName, HTMLAnchorElement>;
  rects: Map<AgentName, RectCache>;
  currentX: number;
  currentW: number;
  targetX: number;
  targetW: number;
  rafId: number | null;
  observer: ResizeObserver | null;
  measure: () => void;
  moveTo: (agent: AgentName, animate: boolean) => void;
  finishNow: () => void;
  destroy: () => void;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function setButtonLabel(button: Element | null, text: string): void {
  if (!button) return;
  const label = button.querySelector<HTMLElement>('[data-btn-label="true"]');
  if (label) {
    label.textContent = text;
  } else {
    button.textContent = text;
  }
  if (
    button.hasAttribute("aria-label") &&
    !button.hasAttribute("data-copy-button")
  ) {
    button.setAttribute("aria-label", text);
  }
}

function createStatusAnnouncer() {
  let pendingRaf: number | null = null;
  const announce = (message: string) => {
    const region = document.querySelector<HTMLElement>(
      '[data-agents-status="true"]',
    );
    if (!region) return;
    if (pendingRaf !== null) {
      cancelAnimationFrame(pendingRaf);
      pendingRaf = null;
    }
    // Clear then write on the next frame so repeated identical actions re-announce
    // while keeping the SSR role="status" / aria-live="polite" attributes intact.
    region.textContent = "";
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = null;
      region.textContent = message;
    });
  };
  const destroy = () => {
    if (pendingRaf !== null) {
      cancelAnimationFrame(pendingRaf);
      pendingRaf = null;
    }
  };
  return { announce, destroy };
}

function createSwitchController(
  root: HTMLElement,
  initialAgent: AgentName,
): SwitchController {
  const variant = root.getAttribute("data-agent-switch") ?? "hero";
  const track = root.querySelector<HTMLElement>(
    '[data-agent-switch-track="true"]',
  );
  const shell = root.querySelector<HTMLElement>(".site-agent-switch__shell");
  const thumb = root.querySelector<HTMLElement>('[data-agent-thumb="true"]');
  const tabs = new Map<AgentName, HTMLAnchorElement>();
  for (const el of root.querySelectorAll<HTMLAnchorElement>(
    "a[data-agent-tab]",
  )) {
    const raw = el.getAttribute("data-agent-tab");
    if (raw && (AGENTS as readonly string[]).includes(raw)) {
      tabs.set(raw as AgentName, el);
    }
  }

  const rects = new Map<AgentName, RectCache>();
  let currentX = 0;
  let currentW = 0;
  let targetX = 0;
  let targetW = 0;
  let rafId: number | null = null;
  let activeAgent = initialAgent;
  let destroyed = false;

  const applyThumb = (x: number, w: number) => {
    currentX = x;
    currentW = w;
    if (!thumb) return;
    thumb.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    thumb.style.width = `${w.toFixed(2)}px`;
  };

  const cancelAnim = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (thumb) {
      thumb.setAttribute("data-animating", "false");
    }
  };

  const measure = () => {
    if (!shell) return;
    const shellRect = shell.getBoundingClientRect();
    rects.clear();
    for (const [id, tab] of tabs) {
      const r = tab.getBoundingClientRect();
      rects.set(id, {
        left: r.left - shellRect.left,
        width: r.width,
      });
    }
  };

  const finishNow = () => {
    cancelAnim();
    applyThumb(targetX, targetW);
  };

  const moveTo = (agent: AgentName, animate: boolean) => {
    activeAgent = agent;
    if (rects.size === 0) {
      measure();
    }
    const target = rects.get(agent);
    if (!target) return;
    targetX = target.left;
    targetW = target.width;

    const shouldAnimate =
      animate &&
      !prefersReducedMotion() &&
      !document.hidden &&
      (Math.abs(targetX - currentX) > 0.5 ||
        Math.abs(targetW - currentW) > 0.5);

    cancelAnim();
    if (!shouldAnimate) {
      applyThumb(targetX, targetW);
      return;
    }

    const fromX = currentX;
    const fromW = currentW;
    const startTime = performance.now();
    if (thumb) {
      thumb.setAttribute("data-animating", "true");
    }

    // Zero layout reads inside rAF: only interpolates cached measurements.
    const step = (now: number) => {
      if (document.hidden) {
        finishNow();
        return;
      }
      const elapsed = Math.max(0, now - startTime);
      const t = Math.min(1, elapsed / AGENT_THUMB_DURATION_MS);
      const eased = easeOutCubic(t);
      applyThumb(
        fromX + (targetX - fromX) * eased,
        fromW + (targetW - fromW) * eased,
      );
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        rafId = null;
        if (thumb) {
          thumb.setAttribute("data-animating", "false");
        }
      }
    };
    rafId = requestAnimationFrame(step);
  };

  measure();
  const initialRect = rects.get(initialAgent);
  if (initialRect) {
    targetX = initialRect.left;
    targetW = initialRect.width;
    applyThumb(initialRect.left, initialRect.width);
    if (thumb) {
      thumb.setAttribute("data-ready", "true");
    }
    root.setAttribute("data-enhanced", "true");
  }

  let observer: ResizeObserver | null = null;
  const syncAfterLayout = () => {
    if (destroyed) return;
    measure();
    const next = rects.get(activeAgent);
    if (next) {
      targetX = next.left;
      targetW = next.width;
      if (rafId === null) {
        applyThumb(next.left, next.width);
      }
    }
  };
  if (shell && typeof ResizeObserver !== "undefined") {
    // Observe only the switch shell container (never document.body).
    observer = new ResizeObserver(syncAfterLayout);
    observer.observe(shell);
  }
  if (typeof document !== "undefined" && document.fonts) {
    if (document.fonts.ready) {
      void document.fonts.ready.then(syncAfterLayout);
    }
    if (typeof document.fonts.addEventListener === "function") {
      document.fonts.addEventListener("loadingdone", syncAfterLayout);
    }
  }

  return {
    root,
    variant,
    track,
    shell,
    thumb,
    tabs,
    rects,
    currentX,
    currentW,
    targetX,
    targetW,
    rafId,
    observer,
    measure,
    moveTo,
    finishNow,
    destroy: () => {
      destroyed = true;
      cancelAnim();
      observer?.disconnect();
      if (
        typeof document !== "undefined" &&
        document.fonts &&
        typeof document.fonts.removeEventListener === "function"
      ) {
        document.fonts.removeEventListener("loadingdone", syncAfterLayout);
      }
      root.removeAttribute("data-enhanced");
    },
  };
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback.
    }
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.setAttribute("aria-hidden", "true");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.select();
    const ok =
      typeof document.execCommand === "function" &&
      document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function readAgentsData(): AgentsIslandData | null {
  const el = document.getElementById("site-agents-data");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as AgentsIslandData;
  } catch {
    return null;
  }
}

export function initAgents(): () => void {
  initShell();
  const stopFaq = initFaq();

  const data = readAgentsData();
  if (!data) {
    return () => {
      stopFaq();
    };
  }

  const cleanups: Array<() => void> = [stopFaq];
  const status = createStatusAnnouncer();
  cleanups.push(status.destroy);

  const initialAgent = parseAgentParam(
    new URLSearchParams(window.location.search).get("agent") ??
      data.activeAgent,
  );
  let activeAgent: AgentName = initialAgent;

  const switchRoots = Array.from(
    document.querySelectorAll<HTMLElement>("[data-agent-switch]"),
  );
  const controllers = switchRoots.map((root) =>
    createSwitchController(root, initialAgent),
  );
  for (const ctrl of controllers) {
    cleanups.push(ctrl.destroy);
  }

  const onVisibilityChange = () => {
    if (document.hidden) {
      for (const ctrl of controllers) {
        ctrl.finishNow();
      }
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  cleanups.push(() =>
    document.removeEventListener("visibilitychange", onVisibilityChange),
  );

  // Copy buttons (step boxes + prompt composer bar)
  const copyResetTimers = new WeakMap<
    HTMLButtonElement,
    ReturnType<typeof setTimeout>
  >();
  const resetCopyButtons = () => {
    for (const btn of document.querySelectorAll<HTMLButtonElement>(
      '[data-copy-button="true"]',
    )) {
      const prev = copyResetTimers.get(btn);
      if (prev) {
        clearTimeout(prev);
        copyResetTimers.delete(btn);
      }
      btn.removeAttribute("data-copied");
      setButtonLabel(btn, data.copy.copyButton);
    }
  };
  cleanups.push(resetCopyButtons);

  const onCopyClick = (event: MouseEvent) => {
    const target = event.currentTarget as HTMLButtonElement | null;
    if (!target) return;
    const text = target.getAttribute("data-copy-text") ?? "";
    const label =
      target.getAttribute("data-copy-label") ?? data.copy.copyButton;
    void copyTextToClipboard(text).then((ok) => {
      if (ok) {
        const prev = copyResetTimers.get(target);
        if (prev) clearTimeout(prev);
        target.setAttribute("data-copied", "true");
        setButtonLabel(target, data.copy.copiedButton);
        status.announce(data.copy.copyStatus.replace("{label}", label));
        const timer = setTimeout(() => {
          copyResetTimers.delete(target);
          target.removeAttribute("data-copied");
          setButtonLabel(target, data.copy.copyButton);
        }, COPY_RESET_MS);
        copyResetTimers.set(target, timer);
      } else {
        status.announce(data.copy.copyFailed);
      }
    });
  };

  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    '[data-copy-button="true"]',
  )) {
    btn.addEventListener("click", onCopyClick);
    cleanups.push(() => btn.removeEventListener("click", onCopyClick));
  }

  // Update DOM to reflect selected agent
  const renderAgent = (
    agent: AgentName,
    options: {
      pushHistory: boolean;
      animate: boolean;
      announce: boolean;
    },
  ) => {
    const profile = data.profiles[agent];
    if (!profile) return;
    activeAgent = agent;
    resetCopyButtons();

    for (const ctrl of controllers) {
      ctrl.root.setAttribute("data-active-agent", agent);
      for (const [id, tab] of ctrl.tabs) {
        const selected = id === agent;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      ctrl.moveTo(agent, options.animate);
    }

    const heroPanel = document.querySelector<HTMLElement>(
      '[data-agents-hero-panel="true"]',
    );
    heroPanel?.setAttribute("aria-labelledby", `agent-tab-hero-${agent}`);

    const stepsPanel = document.querySelector<HTMLElement>(
      '[data-agents-steps-panel="true"]',
    );
    stepsPanel?.setAttribute("aria-labelledby", `agent-tab-connect-${agent}`);

    const lineA = document.querySelector<HTMLElement>(
      '[data-hero-line-a="true"]',
    );
    if (lineA) lineA.textContent = profile.heroLineA;

    const lineB = document.querySelector<HTMLElement>(
      '[data-hero-line-b="true"]',
    );
    if (lineB) lineB.textContent = profile.heroLineB;

    const markWrap = document.querySelector<HTMLElement>(
      '[data-hero-mark-wrap="true"]',
    );
    const markTpl = document.querySelector<HTMLTemplateElement>(
      `template[data-agent-mark="${agent}"]`,
    );
    if (markWrap && markTpl) {
      markWrap.replaceChildren(markTpl.content.cloneNode(true));
    }

    const lede = document.querySelector<HTMLElement>('[data-hero-lede="true"]');
    if (lede) lede.textContent = profile.heroLede;

    const primaryCta = document.querySelector<HTMLAnchorElement>(
      '[data-hero-primary-cta="true"]',
    );
    if (primaryCta) {
      primaryCta.setAttribute("href", profile.primaryCtaHref);
      setButtonLabel(primaryCta, profile.primaryCtaLabel);
    }

    const mockClient = document.querySelector<HTMLElement>(
      '[data-mock-client="true"]',
    );
    if (mockClient) mockClient.textContent = profile.mockChat.clientLabel;

    const mockBadge = document.querySelector<HTMLElement>(
      '[data-mock-badge="true"]',
    );
    if (mockBadge) mockBadge.textContent = profile.transportBadge;

    const mockPrompt = document.querySelector<HTMLElement>(
      '[data-mock-prompt="true"]',
    );
    if (mockPrompt) mockPrompt.textContent = profile.mockChat.userPrompt;

    const mockTool = document.querySelector<HTMLElement>(
      '[data-mock-tool="true"]',
    );
    if (mockTool) mockTool.textContent = profile.mockChat.toolName;

    const mockToolMeta = document.querySelector<HTMLElement>(
      '[data-mock-tool-meta="true"]',
    );
    if (mockToolMeta) mockToolMeta.textContent = profile.mockChat.toolMeta;

    const mockReply = document.querySelector<HTMLElement>(
      '[data-mock-reply="true"]',
    );
    if (mockReply) mockReply.textContent = profile.mockChat.assistantReply;

    const stepArtAgent = document.querySelector<HTMLElement>(
      '[data-connect-art-agent="true"]',
    );
    if (stepArtAgent) {
      stepArtAgent.textContent = `${profile.name} -> /api/mcp`;
    }

    for (let i = 0; i < 3; i++) {
      const step = profile.connectSteps[i];
      if (!step) continue;
      const titleEl = document.querySelector<HTMLElement>(
        `[data-step-title="${i}"]`,
      );
      if (titleEl) titleEl.textContent = step.title;
      const lineEl = document.querySelector<HTMLElement>(
        `[data-step-line="${i}"]`,
      );
      if (lineEl) lineEl.textContent = step.line;

      const copyBox = document.querySelector<HTMLElement>(
        `[data-step-copy-box="${i}"]`,
      );
      const copyCode = document.querySelector<HTMLElement>(
        `[data-step-copy-code="${i}"]`,
      );
      const copyBtn = document.querySelector<HTMLButtonElement>(
        `[data-step-copy-btn="${i}"]`,
      );
      const hasCopy = Boolean(step.copyText);
      if (copyBox) copyBox.hidden = !hasCopy;
      if (copyCode) copyCode.textContent = step.copyText ?? "";
      if (copyBtn) {
        copyBtn.setAttribute("data-copy-text", step.copyText ?? "");
        const copyLabel = step.copyLabel ?? data.copy.copyButton;
        copyBtn.setAttribute("data-copy-label", copyLabel);
        copyBtn.setAttribute("aria-label", copyLabel);
        copyBtn.setAttribute("data-copy-kind", step.copyKind ?? "cli");
      }
    }

    const connectCta = document.querySelector<HTMLAnchorElement>(
      '[data-agents-connect-cta="true"]',
    );
    if (connectCta) {
      connectCta.setAttribute("href", profile.connectCtaHref);
      setButtonLabel(connectCta, profile.connectCtaLabel);
    }

    const closingPrimary = document.querySelector<HTMLAnchorElement>(
      '[data-closing-primary="agents"]',
    );
    if (closingPrimary) {
      closingPrimary.setAttribute("href", profile.primaryCtaHref);
    }

    const firstFaqAnswer = document.querySelector<HTMLElement>(
      "#faq .site-faq__item:first-child .site-faq__fold p",
    );
    if (firstFaqAnswer) {
      firstFaqAnswer.textContent = profile.faqClientAnswer;
    }

    if (options.pushHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set("agent", agent);
      const nextHref = `${url.pathname}${url.search}${url.hash}`;
      if (
        `${window.location.pathname}${window.location.search}${window.location.hash}` !==
        nextHref
      ) {
        window.history.pushState({ agent }, "", nextHref);
      }
    }

    if (options.announce) {
      status.announce(
        data.copy.switchedStatus.replace("{agent}", profile.name),
      );
    }
  };

  // If URL already differed from SSR default, align immediately without animating.
  if (initialAgent !== data.activeAgent) {
    renderAgent(initialAgent, {
      pushHistory: false,
      animate: false,
      announce: false,
    });
  }

  for (const ctrl of controllers) {
    for (const [id, tab] of ctrl.tabs) {
      const onClick = (event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        if (id === activeAgent) return;
        renderAgent(id, {
          pushHistory: true,
          animate: true,
          announce: true,
        });
      };
      tab.addEventListener("click", onClick);
      cleanups.push(() => tab.removeEventListener("click", onClick));

      const onKeyDown = (event: KeyboardEvent) => {
        const idx = AGENTS.indexOf(id);
        if (idx === -1) return;
        let nextIdx = -1;
        if (event.key === "ArrowRight") nextIdx = (idx + 1) % AGENTS.length;
        else if (event.key === "ArrowLeft")
          nextIdx = (idx - 1 + AGENTS.length) % AGENTS.length;
        else if (event.key === "Home") nextIdx = 0;
        else if (event.key === "End") nextIdx = AGENTS.length - 1;
        else return;

        event.preventDefault();
        const nextAgent = AGENTS[nextIdx];
        renderAgent(nextAgent, {
          pushHistory: true,
          animate: true,
          announce: true,
        });
        const nextTab = ctrl.tabs.get(nextAgent);
        if (nextTab) {
          nextTab.focus();
          if (typeof nextTab.scrollIntoView === "function") {
            nextTab.scrollIntoView({
              block: "nearest",
              inline: "nearest",
              behavior: prefersReducedMotion() ? "auto" : "smooth",
            });
          }
        }
      };
      tab.addEventListener("keydown", onKeyDown);
      cleanups.push(() => tab.removeEventListener("keydown", onKeyDown));
    }
  }

  const onPopState = () => {
    const next = parseAgentParam(
      new URLSearchParams(window.location.search).get("agent"),
    );
    if (next !== activeAgent) {
      renderAgent(next, {
        pushHistory: false,
        animate: true,
        announce: false,
      });
    }
  };
  window.addEventListener("popstate", onPopState);
  cleanups.push(() => window.removeEventListener("popstate", onPopState));

  // #how-to-connect smooth scroll
  const onAnchorClick = (event: MouseEvent) => {
    const link = event.currentTarget as HTMLAnchorElement | null;
    if (!link) return;
    const target = document.getElementById("how-to-connect");
    if (!target) return;
    event.preventDefault();
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    }
    const url = new URL(window.location.href);
    url.hash = "#how-to-connect";
    window.history.pushState(
      { agent: activeAgent },
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  };
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    'a[href="#how-to-connect"]',
  )) {
    link.addEventListener("click", onAnchorClick);
    cleanups.push(() => link.removeEventListener("click", onAnchorClick));
  }

  // Tool catalog filter + show all toggle
  const toolsGrid = document.querySelector<HTMLElement>(
    '[data-tools-grid="true"]',
  );
  const toolsToggle = document.querySelector<HTMLButtonElement>(
    '[data-tools-toggle="true"]',
  );
  const toolFilters = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-tool-filter]"),
  );
  const toolCards = Array.from(
    document.querySelectorAll<HTMLElement>("[data-tool-card]"),
  );
  let activeCategory = "all";
  let toolsExpanded = false;

  const syncTools = () => {
    for (const btn of toolFilters) {
      const cat = btn.getAttribute("data-tool-filter") ?? "all";
      btn.setAttribute("aria-pressed", String(cat === activeCategory));
    }
    for (const card of toolCards) {
      const cat = card.getAttribute("data-tool-category") ?? "";
      const isExtra = card.getAttribute("data-tool-extra") === "true";
      if (activeCategory === "all") {
        card.hidden = !toolsExpanded && isExtra;
      } else {
        card.hidden = cat !== activeCategory;
      }
    }
    if (toolsGrid) {
      toolsGrid.setAttribute("data-tools-expanded", String(toolsExpanded));
    }
    if (toolsToggle) {
      const showToggle = activeCategory === "all";
      toolsToggle.hidden = !showToggle;
      toolsToggle.setAttribute("aria-expanded", String(toolsExpanded));
      const label = toolsExpanded
        ? (toolsToggle.getAttribute("data-label-less") ?? "")
        : (toolsToggle.getAttribute("data-label-more") ?? "");
      if (label) setButtonLabel(toolsToggle, label);
    }
  };

  for (const btn of toolFilters) {
    const onFilter = () => {
      activeCategory = btn.getAttribute("data-tool-filter") ?? "all";
      syncTools();
    };
    btn.addEventListener("click", onFilter);
    cleanups.push(() => btn.removeEventListener("click", onFilter));
  }

  if (toolsToggle) {
    const onToggle = () => {
      toolsExpanded = !toolsExpanded;
      syncTools();
    };
    toolsToggle.addEventListener("click", onToggle);
    cleanups.push(() => toolsToggle.removeEventListener("click", onToggle));
  }

  // Prompt cloud chips -> composer bar
  const promptChips = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-prompt-chip]"),
  );
  const promptActive = document.querySelector<HTMLElement>(
    '[data-prompt-active="true"]',
  );
  const promptCopyBtn = document.querySelector<HTMLButtonElement>(
    '[data-prompt-copy-btn="true"]',
  );

  for (const chip of promptChips) {
    const onPromptClick = () => {
      const text = chip.getAttribute("data-prompt-text") ?? "";
      for (const other of promptChips) {
        other.setAttribute("aria-pressed", String(other === chip));
      }
      if (promptActive) promptActive.textContent = text;
      if (promptCopyBtn) {
        promptCopyBtn.setAttribute("data-copy-text", text);
      }
    };
    chip.addEventListener("click", onPromptClick);
    cleanups.push(() => chip.removeEventListener("click", onPromptClick));
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initAgents();
}
