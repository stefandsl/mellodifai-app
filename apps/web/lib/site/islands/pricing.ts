// Interactive islands for pricing (period switch with sliding thumb + FAQ accordion).
import { initFaqAccordion } from "./faq";
import { initPeriodSwitch } from "./period-switch";
import { initShell } from "./shell";

export { initFaqAccordion as initPricingFaq };

export function initPricing(): void {
  initShell();
  initPeriodSwitch();
  initFaqAccordion();
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initPricing();
}
