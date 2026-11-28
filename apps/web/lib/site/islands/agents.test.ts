// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMark } from "@/components/site/agent-switch";
import { AgentsPage } from "@/components/site/agents-page";
import { TOKEN_OPS } from "@/lib/ops/registry";
import {
  AGENTS,
  type AgentName,
  CLI_INSTALL_COMMAND,
  getAgentProfile,
  getAllAgentProfiles,
} from "../agents";
import { SITE_COPY } from "../copy";
import { AGENT_THUMB_DURATION_MS, initAgents } from "./agents";

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected element or value: ${label}`);
  }
  return value;
}

function installAgentsDom(initialAgent: AgentName = "claude") {
  const copy = SITE_COPY.en;
  const profiles = getAllAgentProfiles("en");
  const bodyHtml = renderToStaticMarkup(
    createElement(AgentsPage, { agent: initialAgent, lang: "en", copy }),
  );
  const markTemplates = AGENTS.map((id) => {
    const markup = renderToStaticMarkup(
      createElement(AgentMark, {
        agent: id,
        className: "site-agents-hero__mark",
      }),
    );
    return `<template data-agent-mark="${id}">${markup}</template>`;
  }).join("");
  const payload = {
    activeAgent: initialAgent,
    profiles,
    copy: {
      copyButton: copy.agents.copyButton,
      copiedButton: copy.agents.copiedButton,
      copyStatus: copy.agents.copiedStatus,
      copyFailed: copy.agents.copyFailedStatus,
      switchedStatus: copy.agents.agentSelectedStatus,
    },
  };
  document.documentElement.lang = "en";
  document.body.innerHTML = `${bodyHtml}${markTemplates}<script type="application/json" id="site-agents-data">${JSON.stringify(payload)}</script>`;
  window.history.replaceState(null, "", `/agents?agent=${initialAgent}`);
}

function mockSwitchRects() {
  const shells = document.querySelectorAll<HTMLElement>(
    ".site-agent-switch__shell",
  );
  for (const shell of shells) {
    vi.spyOn(shell, "getBoundingClientRect").mockImplementation(() => ({
      x: 100,
      y: 20,
      top: 20,
      left: 100,
      right: 600,
      bottom: 60,
      width: 500,
      height: 40,
      toJSON: () => ({}),
    }));
    const tabs = shell.querySelectorAll<HTMLElement>("a[data-agent-tab]");
    tabs.forEach((tab, idx) => {
      const left = 100 + idx * 100;
      const width = 92 + idx * 4;
      vi.spyOn(tab, "getBoundingClientRect").mockImplementation(() => ({
        x: left,
        y: 20,
        top: 20,
        left,
        right: left + width,
        bottom: 60,
        width,
        height: 40,
        toJSON: () => ({}),
      }));
    });
  }
}

function createFakeRaf() {
  let now = 1000;
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    callbacks.delete(id);
  });

  return {
    pendingCount: () => callbacks.size,
    advance(ms: number) {
      now += ms;
      const batch = [...callbacks.entries()];
      callbacks.clear();
      for (const [, cb] of batch) {
        cb(now);
      }
    },
  };
}

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

describe("agents island (lib/site/islands/agents.ts)", () => {
  let destroy: (() => void) | null = null;

  beforeEach(() => {
    (
      window as unknown as { __SITE_ISLAND_MANUAL_INIT__?: boolean }
    ).__SITE_ISLAND_MANUAL_INIT__ = true;
    mockReducedMotion(false);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
  });

  afterEach(() => {
    destroy?.();
    destroy = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("renders plain Tab-reachable links with #how-to-connect on connect switch in SSR, then promotes to ARIA tablist after initAgents", () => {
    createFakeRaf();
    installAgentsDom("claude");

    // Before JS: zero role="tab", zero role="tablist", zero role="tabpanel", zero tabindex="-1".
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(0);
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(0);
    const ssrLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a[data-agent-tab]"),
    );
    expect(ssrLinks).toHaveLength(AGENTS.length * 2);
    for (const link of ssrLinks) {
      expect(link.getAttribute("tabindex")).toBeNull();
    }
    const heroActive = must(
      document.querySelector<HTMLAnchorElement>(
        '[data-agent-switch="hero"] a[data-agent-tab="claude"]',
      ),
      "hero active link",
    );
    expect(heroActive.getAttribute("aria-current")).toBe("page");
    expect(heroActive.getAttribute("href")).toBe("/agents?agent=claude");

    // Connect switch links preserve #how-to-connect for no-JS reloads.
    const connectLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '[data-agent-switch="connect"] a[data-agent-tab]',
      ),
    );
    for (const link of connectLinks) {
      const id = link.getAttribute("data-agent-tab");
      expect(link.getAttribute("href")).toBe(
        `/agents?agent=${id}#how-to-connect`,
      );
    }

    // After initAgents(): promoted to ARIA tablist with roving tabIndex.
    mockSwitchRects();
    destroy = initAgents();
    expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(2);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(
      AGENTS.length * 2,
    );
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(2);
    expect(heroActive.getAttribute("aria-current")).toBeNull();
    expect(heroActive.getAttribute("aria-selected")).toBe("true");
    expect(heroActive.tabIndex).toBe(0);
    const unselected = must(
      document.querySelector<HTMLAnchorElement>(
        '[data-agent-switch="hero"] a[data-agent-tab="chatgpt"]',
      ),
      "chatgpt link",
    );
    expect(unselected.tabIndex).toBe(-1);

    // destroy() restores plain links cleanly.
    destroy();
    destroy = null;
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(unselected.getAttribute("tabindex")).toBeNull();
    expect(heroActive.getAttribute("aria-current")).toBe("page");
  });

  it("switches agents without reload, updates URL via pushState, handles popstate, syncs both switches, and updates steps, badges, docs, and FAQ", () => {
    const raf = createFakeRaf();
    installAgentsDom("claude");
    mockSwitchRects();
    destroy = initAgents();

    const heroSwitch = must(
      document.querySelector<HTMLElement>('[data-agent-switch="hero"]'),
      "hero switch",
    );
    const connectSwitch = must(
      document.querySelector<HTMLElement>('[data-agent-switch="connect"]'),
      "connect switch",
    );
    expect(heroSwitch.getAttribute("data-enhanced")).toBe("true");
    expect(connectSwitch.getAttribute("data-enhanced")).toBe("true");

    const chatgptTab = must(
      heroSwitch.querySelector<HTMLAnchorElement>(
        'a[data-agent-tab="chatgpt"]',
      ),
      "chatgpt tab",
    );
    chatgptTab.click();
    raf.advance(16);

    expect(window.location.search).toBe("?agent=chatgpt");
    expect(heroSwitch.getAttribute("data-active-agent")).toBe("chatgpt");
    expect(connectSwitch.getAttribute("data-active-agent")).toBe("chatgpt");

    const chatgpt = getAgentProfile("chatgpt", "en");
    expect(
      document.querySelector('[data-hero-line-b="true"]')?.textContent,
    ).toBe(chatgpt.heroLineB);
    expect(document.querySelector('[data-step-title="0"]')?.textContent).toBe(
      chatgpt.connectSteps[0].title,
    );
    expect(
      must(
        document.querySelector<HTMLElement>('[data-step-copy-box="0"]'),
        "step 0 copy box",
      ).hidden,
    ).toBe(true);
    expect(
      must(
        document.querySelector<HTMLElement>('[data-step-badge="0"]'),
        "step 0 badge",
      ).hidden,
    ).toBe(false);
    expect(document.querySelector('[data-step-badge="0"]')?.textContent).toBe(
      chatgpt.connectSteps[0].statusBadge,
    );
    expect(
      document.querySelector('[data-step-copy-code="1"]')?.textContent,
    ).toBe(chatgpt.connectSteps[1].copyText);
    expect(
      document.querySelector(
        "#faq .site-faq__item:first-child .site-faq__fold p",
      )?.textContent,
    ).toBe(chatgpt.faqClientAnswer);
    expect(
      document.querySelector('[data-agents-status="true"]')?.textContent,
    ).toContain("ChatGPT");

    // Simulate browser Back to ?agent=claude
    window.history.replaceState(
      { agent: "claude" },
      "",
      "/agents?agent=claude",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(heroSwitch.getAttribute("data-active-agent")).toBe("claude");
    expect(connectSwitch.getAttribute("data-active-agent")).toBe("claude");
    expect(
      document.querySelector('[data-hero-line-b="true"]')?.textContent,
    ).toBe(getAgentProfile("claude", "en").heroLineB);
    expect(
      must(
        document.querySelector<HTMLElement>('[data-step-copy-box="0"]'),
        "step 0 copy box restored",
      ).hidden,
    ).toBe(false);
  });

  it("uses replaceState for arrow-key moves and deduplicates #how-to-connect anchor clicks without pushing history entries", () => {
    createFakeRaf();
    installAgentsDom("claude");
    mockSwitchRects();
    destroy = initAgents();

    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    const heroSwitch = must(
      document.querySelector<HTMLElement>('[data-agent-switch="hero"]'),
      "hero switch",
    );
    const claudeTab = must(
      heroSwitch.querySelector<HTMLAnchorElement>('a[data-agent-tab="claude"]'),
      "claude tab",
    );
    claudeTab.focus();

    // Stepping across tabs with arrow keys, End, and Home uses replaceState, never pushState.
    claudeTab.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(heroSwitch.getAttribute("data-active-agent")).toBe("chatgpt");
    expect(document.activeElement?.getAttribute("data-agent-tab")).toBe(
      "chatgpt",
    );

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    expect(heroSwitch.getAttribute("data-active-agent")).toBe(
      AGENTS[AGENTS.length - 1],
    );

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(heroSwitch.getAttribute("data-active-agent")).toBe(AGENTS[0]);

    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledTimes(3);

    // Clicking a real tab pushes a single history entry.
    replaceSpy.mockClear();
    must(
      heroSwitch.querySelector<HTMLAnchorElement>('a[data-agent-tab="gemini"]'),
      "gemini tab",
    ).click();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).not.toHaveBeenCalled();

    // Clicking #how-to-connect twice never pushes history and skips the second replaceState.
    pushSpy.mockClear();
    replaceSpy.mockClear();
    const anchor = must(
      document.querySelector<HTMLAnchorElement>('a[href="#how-to-connect"]'),
      "how-to-connect anchor",
    );
    anchor.click();
    expect(window.location.hash).toBe("#how-to-connect");
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledTimes(1);

    anchor.click();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it("animates the sliding thumb within 400ms with zero per-frame layout reads and pauses when tab is hidden", () => {
    const raf = createFakeRaf();
    installAgentsDom("claude");
    mockSwitchRects();
    destroy = initAgents();

    const heroSwitch = must(
      document.querySelector<HTMLElement>('[data-agent-switch="hero"]'),
      "hero switch",
    );
    const thumb = must(
      heroSwitch.querySelector<HTMLElement>('[data-agent-thumb="true"]'),
      "thumb",
    );
    const initialTransform = thumb.style.transform;

    // Spy on layout reads AFTER init completes: animation frames must perform 0 layout reads.
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const styleSpy = vi.spyOn(window, "getComputedStyle");

    must(
      heroSwitch.querySelector<HTMLAnchorElement>('a[data-agent-tab="cursor"]'),
      "cursor tab",
    ).click();
    expect(thumb.getAttribute("data-animating")).toBe("true");

    // Step through half the animation.
    raf.advance(AGENT_THUMB_DURATION_MS / 2);
    expect(thumb.style.transform).not.toBe(initialTransform);
    expect(thumb.getAttribute("data-animating")).toBe("true");
    expect(rectSpy).not.toHaveBeenCalled();
    expect(styleSpy).not.toHaveBeenCalled();

    // Finish within AGENT_THUMB_DURATION_MS (<= 400 ms).
    raf.advance(AGENT_THUMB_DURATION_MS);
    expect(AGENT_THUMB_DURATION_MS).toBeLessThanOrEqual(400);
    expect(thumb.getAttribute("data-animating")).toBe("false");
    expect(thumb.style.transform).toBe("translate3d(400.00px, 0, 0)");
    expect(rectSpy).not.toHaveBeenCalled();
    expect(styleSpy).not.toHaveBeenCalled();

    // Start another slide, then hide the tab: rAF cancels and thumb snaps cleanly.
    must(
      heroSwitch.querySelector<HTMLAnchorElement>('a[data-agent-tab="gemini"]'),
      "gemini tab",
    ).click();
    expect(thumb.getAttribute("data-animating")).toBe("true");
    expect(raf.pendingCount()).toBeGreaterThan(0);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(thumb.getAttribute("data-animating")).toBe("false");
    expect(thumb.style.transform).toBe("translate3d(200.00px, 0, 0)");
    // Flush any status announcement frame; no thumb frames remain.
    raf.advance(16);
    expect(raf.pendingCount()).toBe(0);
  });

  it("snaps immediately without animation under prefers-reduced-motion", () => {
    mockReducedMotion(true);
    const raf = createFakeRaf();
    installAgentsDom("claude");
    mockSwitchRects();
    destroy = initAgents();

    const heroSwitch = must(
      document.querySelector<HTMLElement>('[data-agent-switch="hero"]'),
      "hero switch",
    );
    const thumb = must(
      heroSwitch.querySelector<HTMLElement>('[data-agent-thumb="true"]'),
      "thumb",
    );
    must(
      heroSwitch.querySelector<HTMLAnchorElement>('a[data-agent-tab="codex"]'),
      "codex tab",
    ).click();

    expect(thumb.getAttribute("data-animating")).toBe("false");
    expect(thumb.style.transform).toBe("translate3d(300.00px, 0, 0)");
    // Flush status frame; no thumb animation frames queued.
    raf.advance(16);
    expect(raf.pendingCount()).toBe(0);
  });

  it("copies step command, updates button label, resets after timeout, and announces to the SSR status region", async () => {
    vi.useFakeTimers();
    const raf = createFakeRaf();
    installAgentsDom("claude");
    mockSwitchRects();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    destroy = initAgents();

    const statusRegion = must(
      document.querySelector<HTMLElement>('[data-agents-status="true"]'),
      "status region",
    );
    expect(statusRegion.getAttribute("role")).toBe("status");
    expect(statusRegion.getAttribute("aria-live")).toBe("polite");

    const copyBtn = must(
      document.querySelector<HTMLButtonElement>('[data-step-copy-btn="0"]'),
      "copy button",
    );
    const expectedText = must(
      copyBtn.getAttribute("data-copy-text"),
      "copy text",
    );
    expect(expectedText).toBe(CLI_INSTALL_COMMAND);

    copyBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    raf.advance(16);

    expect(writeText).toHaveBeenCalledWith(expectedText);
    expect(copyBtn.getAttribute("data-copied")).toBe("true");
    expect(copyBtn.querySelector('[data-btn-label="true"]')?.textContent).toBe(
      "Copied",
    );
    expect(statusRegion.textContent).toContain("Copied");

    vi.advanceTimersByTime(2000);
    expect(copyBtn.hasAttribute("data-copied")).toBe(false);
    expect(copyBtn.querySelector('[data-btn-label="true"]')?.textContent).toBe(
      "Copy",
    );
  });

  it("filters MCP tools by category, expands all 38 tools, updates prompt composer bar, and toggles FAQ items", () => {
    createFakeRaf();
    installAgentsDom("claude");
    mockSwitchRects();
    destroy = initAgents();

    const allCards = Array.from(
      document.querySelectorAll<HTMLElement>("[data-tool-card]"),
    );
    expect(allCards).toHaveLength(TOKEN_OPS.length);
    expect(allCards.filter((c) => !c.hidden)).toHaveLength(12);

    const toggleBtn = must(
      document.querySelector<HTMLButtonElement>('[data-tools-toggle="true"]'),
      "tools toggle",
    );
    toggleBtn.click();
    expect(allCards.filter((c) => !c.hidden)).toHaveLength(TOKEN_OPS.length);
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");

    const publishFilter = must(
      document.querySelector<HTMLButtonElement>('[data-tool-filter="publish"]'),
      "publish filter",
    );
    publishFilter.click();
    expect(publishFilter.getAttribute("aria-pressed")).toBe("true");
    expect(toggleBtn.hidden).toBe(true);
    const visiblePublish = allCards.filter((c) => !c.hidden);
    expect(visiblePublish.length).toBeGreaterThan(0);
    expect(
      visiblePublish.every(
        (c) => c.getAttribute("data-tool-category") === "publish",
      ),
    ).toBe(true);

    // Prompt cloud selection updates composer bar and copy button payload.
    const secondPrompt = must(
      document.querySelector<HTMLButtonElement>('[data-prompt-chip="1"]'),
      "second prompt chip",
    );
    const expectedPrompt = must(
      secondPrompt.getAttribute("data-prompt-text"),
      "second prompt text",
    );
    secondPrompt.click();
    expect(secondPrompt.getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelector('[data-prompt-active="true"]')?.textContent,
    ).toBe(expectedPrompt);
    expect(
      document
        .querySelector('[data-prompt-copy-btn="true"]')
        ?.getAttribute("data-copy-text"),
    ).toBe(expectedPrompt);

    // FAQ accordion opens one item at a time.
    const faqTriggers = document.querySelectorAll<HTMLButtonElement>(
      "#faq .site-faq__trigger",
    );
    expect(faqTriggers[0].getAttribute("aria-expanded")).toBe("true");
    faqTriggers[1].click();
    expect(faqTriggers[0].getAttribute("aria-expanded")).toBe("false");
    expect(faqTriggers[1].getAttribute("aria-expanded")).toBe("true");
  });
});
