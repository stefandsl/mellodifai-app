// Shared interactive shell for static public site pages (header scroll state,
// agents hover/keyboard menu, phone modal menu, and post-LCP web font loading).

const THEME_KEY = "mellodifai-theme";
const MOBILE_BREAKPOINT = "(min-width: 48em)";

function syncTheme(): void {
  try {
    if (localStorage.getItem(THEME_KEY) === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch {
    // Storage can be blocked; dark theme stays.
  }
}

function initHeaderScroll(): void {
  const header = document.querySelector<HTMLElement>(".site-header");
  if (!header) return;
  const update = () => {
    header.setAttribute("data-scrolled", window.scrollY > 8 ? "true" : "false");
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
}

function initPhoneMenu(): void {
  const opener = document.querySelector<HTMLButtonElement>(".site-menu__open");
  const dialog = document.querySelector<HTMLDialogElement>("dialog.site-menu");
  if (!opener || !dialog) return;

  const setOpen = (open: boolean) => {
    opener.setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("site-menu-open", open);
  };

  const show = () => {
    if (!dialog.open) dialog.showModal();
    setOpen(true);
  };

  const hide = () => {
    if (dialog.open) dialog.close();
  };

  opener.addEventListener("click", show);

  const closer = dialog.querySelector<HTMLButtonElement>(
    ".site-menu__bar button",
  );
  if (closer) closer.addEventListener("click", hide);

  for (const link of dialog.querySelectorAll<HTMLAnchorElement>(
    ".site-menu__link",
  )) {
    link.addEventListener("click", hide);
  }

  dialog.addEventListener("close", () => {
    setOpen(false);
    opener.focus();
  });

  const wide = window.matchMedia(MOBILE_BREAKPOINT);
  const onWide = () => {
    if (wide.matches && dialog.open) dialog.close();
  };
  wide.addEventListener("change", onWide);
}

type AgentItem = {
  title: string;
  description: string;
  href: string;
};

function initAgentsMenu(): void {
  const host = document.querySelector<HTMLElement>("[data-site-agents-menu]");
  if (!host) return;
  const trigger = host.querySelector<HTMLButtonElement>("button");
  const raw = host.getAttribute("data-site-agents-menu");
  if (!trigger || !raw) return;

  let items: AgentItem[] = [];
  try {
    items = JSON.parse(raw) as AgentItem[];
  } catch {
    return;
  }
  if (!items.length) return;

  const menuId = "site-agents-popover";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", menuId);

  const menu = document.createElement("div");
  menu.id = menuId;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", trigger.textContent?.trim() || "Agents");
  menu.className = "site-agents-popover";
  menu.hidden = true;

  const links: HTMLAnchorElement[] = [];
  for (const item of items) {
    const a = document.createElement("a");
    a.href = item.href;
    a.setAttribute("role", "menuitem");
    a.tabIndex = -1;
    a.draggable = false;
    a.className = "site-agents-popover__item";

    const title = document.createElement("span");
    title.className = "site-agents-popover__title";
    title.textContent = item.title;

    const desc = document.createElement("span");
    desc.className = "site-agents-popover__desc";
    desc.textContent = item.description;

    a.append(title, desc);
    menu.appendChild(a);
    links.push(a);
  }

  host.appendChild(menu);

  let isOpen = false;
  let hideTimer: number | null = null;

  const clearHide = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const focusIndex = (idx: number) => {
    const wrapped = (idx + links.length) % links.length;
    for (let i = 0; i < links.length; i++) {
      links[i].tabIndex = i === wrapped ? 0 : -1;
    }
    links[wrapped]?.focus();
  };

  const open = (focusFirst = false) => {
    clearHide();
    if (!isOpen) {
      isOpen = true;
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      if (links[0]) links[0].tabIndex = 0;
    }
    if (focusFirst) focusIndex(0);
  };

  const close = (restoreFocus = false) => {
    clearHide();
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  };

  const scheduleClose = () => {
    clearHide();
    hideTimer = window.setTimeout(() => close(false), 180);
  };

  trigger.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "touch") open(false);
  });
  trigger.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch") scheduleClose();
  });
  menu.addEventListener("pointerenter", clearHide);
  menu.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch") scheduleClose();
  });

  trigger.addEventListener("click", () => {
    if (isOpen) close(false);
    else open(false);
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    }
  });

  menu.addEventListener("keydown", (e) => {
    const current = links.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusIndex(current < 0 ? 0 : current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex(current < 0 ? links.length - 1 : current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusIndex(links.length - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ch = e.key.toLowerCase();
      const idx = links.findIndex((el) =>
        (el.textContent || "").trim().toLowerCase().startsWith(ch),
      );
      if (idx >= 0) {
        e.preventDefault();
        focusIndex(idx);
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      close(true);
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (isOpen && !host.contains(e.target as Node)) {
      close(false);
    }
  });
}

function initDeferredFonts(): void {
  if (document.querySelector('link[data-site-fonts="true"]')) return;
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/site/fonts.css";
    link.setAttribute("data-site-fonts", "true");
    document.head.appendChild(link);
  };

  const supportsLcp =
    typeof PerformanceObserver !== "undefined" &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes(
      "largest-contentful-paint",
    );

  if (supportsLcp) {
    try {
      const obs = new PerformanceObserver((list) => {
        if (list.getEntries().length > 0) {
          obs.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(load));
        }
      });
      obs.observe({ type: "largest-contentful-paint", buffered: true });
      window.setTimeout(load, 600);
      return;
    } catch {
      // Fall through to load fallback.
    }
  }

  if (document.readyState === "complete") {
    requestAnimationFrame(() => window.setTimeout(load, 0));
  } else {
    window.addEventListener(
      "load",
      () => requestAnimationFrame(() => window.setTimeout(load, 0)),
      { once: true },
    );
  }
}

export function initShell(): void {
  syncTheme();
  initHeaderScroll();
  initPhoneMenu();
  initAgentsMenu();
  initDeferredFonts();
}
