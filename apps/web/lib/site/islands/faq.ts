// Shared interactive FAQ accordion island (used by home, pricing, and agents).
// Single-open exclusive accordion: each button toggles aria-expanded, data-open,
// and panel inert state. Mouse click, Enter, and Space toggle via native button click;
// ArrowDown/ArrowUp/Home/End move keyboard focus across triggers.

export function initFaq(): () => void {
  const lists = document.querySelectorAll<HTMLElement>(".site-faq__list");
  if (!lists.length) return () => {};

  const cleanups: (() => void)[] = [];

  for (const list of lists) {
    if (list.dataset.faqBound === "true") continue;
    list.dataset.faqBound = "true";
    cleanups.push(() => {
      delete list.dataset.faqBound;
    });

    const items = Array.from(
      list.querySelectorAll<HTMLElement>(".site-faq__item"),
    );
    const entries = items
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
    if (!entries.length) continue;

    const setOpenIndex = (openIdx: number | null) => {
      for (let i = 0; i < entries.length; i++) {
        const isOpen = openIdx === i;
        const { item, button, panel } = entries[i];
        item.setAttribute("data-open", String(isOpen));
        button.setAttribute("aria-expanded", String(isOpen));
        if (isOpen) {
          panel.removeAttribute("inert");
        } else {
          panel.setAttribute("inert", "");
        }
      }
    };

    for (let i = 0; i < entries.length; i++) {
      const { button } = entries[i];
      const onClick = () => {
        const wasOpen = button.getAttribute("aria-expanded") === "true";
        setOpenIndex(wasOpen ? null : i);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        let nextIdx = -1;
        if (event.key === "ArrowDown") {
          nextIdx = (i + 1) % entries.length;
        } else if (event.key === "ArrowUp") {
          nextIdx = (i - 1 + entries.length) % entries.length;
        } else if (event.key === "Home") {
          nextIdx = 0;
        } else if (event.key === "End") {
          nextIdx = entries.length - 1;
        }
        if (nextIdx >= 0) {
          event.preventDefault();
          entries[nextIdx]?.button.focus();
        }
      };

      button.addEventListener("click", onClick);
      button.addEventListener("keydown", onKeyDown);
      cleanups.push(() => {
        button.removeEventListener("click", onClick);
        button.removeEventListener("keydown", onKeyDown);
      });
    }
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}
