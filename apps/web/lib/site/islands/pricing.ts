// Interactive islands for pricing (period switch with sliding thumb + FAQ accordion).
import { initPeriodSwitch } from "./period-switch";
import { initShell } from "./shell";

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
