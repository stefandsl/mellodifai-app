// Interactive islands for pricing (period switch with sliding thumb + FAQ accordion).
import { initShell } from "./shell";

export function initPeriodSwitch(): void {
  const groups = document.querySelectorAll<HTMLElement>(
    '.site-segmented[role="radiogroup"]',
  );
  if (!groups.length) return;

  for (const group of groups) {
    const radios = Array.from(
      group.querySelectorAll<HTMLButtonElement>('[role="radio"][data-value]'),
    );
    if (radios.length < 2) continue;

    // Derive selected vs unselected StyleX classes from the SSR DOM (zero hardcoded hashes).
    const initSelected =
      radios.find((r) => r.getAttribute("aria-checked") === "true") ??
      radios[0];
    const initUnselected = radios.find((r) => r !== initSelected) ?? radios[1];
    const selSet = new Set(initSelected.classList);
    const unselSet = new Set(initUnselected.classList);
    const selectedOnly = [...selSet].filter((c) => !unselSet.has(c));
    const unselectedOnly = [...unselSet].filter((c) => !selSet.has(c));

    // Ensure exactly one tab stop at rest.
    for (const r of radios) {
      r.tabIndex = r === initSelected ? 0 : -1;
    }

    let current = initSelected.dataset.value || "monthly";
    let animTimer: number | null = null;

    const reducedMotion = () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const applyClasses = (nextVal: string) => {
      for (const r of radios) {
        const isSel = r.dataset.value === nextVal;
        r.setAttribute("aria-checked", String(isSel));
        r.tabIndex = isSel ? 0 : -1;
        for (const c of selectedOnly) r.classList.toggle(c, isSel);
        for (const c of unselectedOnly) r.classList.toggle(c, !isSel);
      }
    };

    const updateUnits = (nextVal: string) => {
      const scope =
        group.closest("main") ?? group.parentElement ?? document.body;
      for (const box of scope.querySelectorAll<HTMLElement>(
        ".site-plan-card__units",
      )) {
        box.setAttribute("data-animate", "true");
        for (const unit of box.querySelectorAll<HTMLElement>(
          ".site-plan-card__unit[data-period]",
        )) {
          const shown = unit.dataset.period === nextVal;
          unit.setAttribute("data-shown", String(shown));
          unit.setAttribute("aria-hidden", String(!shown));
        }
      }
      for (const el of scope.querySelectorAll<HTMLElement>(
        "[data-plan-unit-monthly]",
      )) {
        const text =
          nextVal === "yearly"
            ? el.getAttribute("data-plan-unit-yearly")
            : el.getAttribute("data-plan-unit-monthly");
        if (text !== null) el.textContent = text;
      }
    };

    const slideLens = (
      fromEl: HTMLButtonElement,
      toEl: HTMLButtonElement,
      nextVal: string,
    ) => {
      if (animTimer !== null) {
        window.clearTimeout(animTimer);
        animTimer = null;
      }

      if (reducedMotion()) {
        applyClasses(nextVal);
        group.style.removeProperty("--_segmented-lens-visibility");
        return;
      }

      const gRect = group.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const fromStyle = getComputedStyle(fromEl);

      const copyProps = [
        "background-color",
        "background-image",
        "box-shadow",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-right-radius",
        "border-bottom-left-radius",
        "border-top-width",
        "border-right-width",
        "border-bottom-width",
        "border-left-width",
        "border-top-style",
        "border-right-style",
        "border-bottom-style",
        "border-left-style",
        "border-top-color",
        "border-right-color",
        "border-bottom-color",
        "border-left-color",
      ];
      for (const prop of copyProps) {
        group.style.setProperty(
          `--_segmented-lens-${prop}`,
          fromStyle.getPropertyValue(prop),
        );
      }

      const toLeft = toRect.left - gRect.left - group.clientLeft;
      const toTop = toRect.top - gRect.top - group.clientTop;
      const dx = fromRect.left - toRect.left;

      applyClasses(nextVal);
      toEl.style.setProperty("background-color", "transparent", "important");
      toEl.style.setProperty("box-shadow", "none", "important");

      group.style.setProperty("--_segmented-lens-left", `${toLeft}px`);
      group.style.setProperty("--_segmented-lens-top", `${toTop}px`);
      group.style.setProperty("--_segmented-lens-width", `${toRect.width}px`);
      group.style.setProperty("--_segmented-lens-height", `${toRect.height}px`);
      group.style.setProperty("--_segmented-lens-visibility", "visible");

      const finish = () => {
        animTimer = null;
        toEl.style.removeProperty("background-color");
        toEl.style.removeProperty("box-shadow");
        group.style.removeProperty("--_segmented-lens-visibility");
        group.style.removeProperty("--_segmented-lens-left");
        group.style.removeProperty("--_segmented-lens-top");
        group.style.removeProperty("--_segmented-lens-width");
        group.style.removeProperty("--_segmented-lens-height");
      };

      if (typeof group.animate === "function") {
        try {
          const anim = group.animate(
            [{ translate: `${dx}px 0px` }, { translate: "0px 0px" }],
            {
              pseudoElement: "::before",
              duration: 180,
              easing: "cubic-bezier(0.2, 0, 0, 1)",
              fill: "forwards",
            },
          );
          anim.onfinish = () => {
            anim.cancel();
            finish();
          };
          anim.oncancel = () => {};
          animTimer = window.setTimeout(finish, 260);
          return;
        } catch {
          // Fallback if pseudoElement WAAPI is unsupported in an engine.
        }
      }
      finish();
    };

    const select = (nextVal: string, focus = false) => {
      if (nextVal === current) return;
      const fromEl = radios.find((r) => r.dataset.value === current);
      const toEl = radios.find((r) => r.dataset.value === nextVal);
      if (!fromEl || !toEl) return;
      current = nextVal;
      slideLens(fromEl, toEl, nextVal);
      updateUnits(nextVal);
      if (focus) toEl.focus();
    };

    for (const r of radios) {
      r.addEventListener("click", () => {
        if (r.dataset.value) select(r.dataset.value, false);
      });
    }

    group.addEventListener("keydown", (e) => {
      const idx = radios.findIndex((r) => r.dataset.value === current);
      if (idx < 0) return;
      let nextIdx = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        nextIdx = (idx + 1) % radios.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        nextIdx = (idx - 1 + radios.length) % radios.length;
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else if (e.key === "End") {
        nextIdx = radios.length - 1;
      }
      if (nextIdx >= 0) {
        e.preventDefault();
        const nextVal = radios[nextIdx]?.dataset.value;
        if (nextVal) select(nextVal, true);
      }
    });
  }
}

export function initPricingFaq(): void {
  const lists = document.querySelectorAll<HTMLElement>(".site-faq__list");
  for (const list of lists) {
    const items = Array.from(
      list.querySelectorAll<HTMLElement>(".site-faq__item"),
    );
    const triggers = items
      .map((item) => ({
        item,
        button: item.querySelector<HTMLButtonElement>(".site-faq__trigger"),
        panel: item.querySelector<HTMLElement>(".site-faq__panel"),
      }))
      .filter(
        (
          entry,
        ): entry is {
          item: HTMLElement;
          button: HTMLButtonElement;
          panel: HTMLElement;
        } => Boolean(entry.button && entry.panel),
      );
    if (!triggers.length) continue;

    const setOpenIndex = (openIdx: number | null) => {
      for (let i = 0; i < triggers.length; i++) {
        const isOpen = openIdx === i;
        const { item, button, panel } = triggers[i];
        item.setAttribute("data-open", String(isOpen));
        button.setAttribute("aria-expanded", String(isOpen));
        if (isOpen) {
          panel.removeAttribute("inert");
        } else {
          panel.setAttribute("inert", "");
        }
      }
    };

    for (let i = 0; i < triggers.length; i++) {
      triggers[i].button.addEventListener("click", () => {
        const wasOpen =
          triggers[i].button.getAttribute("aria-expanded") === "true";
        setOpenIndex(wasOpen ? null : i);
      });
    }
  }
}

initShell();
initPeriodSwitch();
initPricingFaq();
