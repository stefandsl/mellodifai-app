// Shared accordion island for the site FAQ sections (Pricing, Agents).
export function initFaq(): void {
  const lists = document.querySelectorAll<HTMLElement>(".site-faq__list");
  for (const list of lists) {
    if (list.dataset.faqBound === "true") continue;
    list.dataset.faqBound = "true";

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
