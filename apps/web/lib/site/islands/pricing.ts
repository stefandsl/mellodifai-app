// Interactive islands for pricing (period switch with sliding thumb + FAQ accordion).
import { initFaq } from "./faq";
import { initPeriodSwitch } from "./period-switch";
import { initShell } from "./shell";

export { initFaq as initPricingFaq };

export function initPricing(): () => void {
  initShell();
  initPeriodSwitch();
  const stopFaq = initFaq();
  return () => {
    stopFaq();
  };
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initPricing();
}
