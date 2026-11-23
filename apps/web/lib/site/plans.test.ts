import { describe, expect, it } from "vitest";
import { SITE_COPY } from "./copy";
import { COMPARE, PLAN_COUNT, RECOMMENDED_PLAN } from "./plans";

describe("plans of the public site", () => {
  it("has one compare cell per plan in every row", () => {
    for (const g of COMPARE)
      for (const r of g.rows) expect(r.cells, r.row).toHaveLength(PLAN_COUNT);
  });

  it("has five compare groups, as in the study", () => {
    expect(COMPARE).toHaveLength(5);
  });

  for (const lang of ["en", "it"] as const)
    it(`names every plan, group, row and text cell in ${lang}`, () => {
      const copy = SITE_COPY[lang];
      expect(copy.plans.items).toHaveLength(PLAN_COUNT);
      expect(RECOMMENDED_PLAN).toBeLessThan(PLAN_COUNT);
      for (const g of COMPARE) {
        expect(copy.pricing.groups[g.group]).toBeTruthy();
        for (const r of g.rows) {
          expect(copy.pricing.rows[r.row]).toBeTruthy();
          for (const c of r.cells)
            if (typeof c === "string")
              expect(copy.pricing.cells[c]).toBeTruthy();
        }
      }
      expect(copy.pricing.faq.length).toBeGreaterThanOrEqual(7);
    });

  // Plan terms (when a plan ends, how you change it, credit periods and top-ups) are the owner's
  // decision with the prices (D1). Until then the page promises none of them.
  it("promises no plan term before the owner sets the prices", () => {
    const promises = [
      /any time/iu,
      /close of the period/iu,
      /quando vuoi/iu,
      /chiusura del periodo/iu,
      /next period|top-up|periodo successivo|ricarica/iu,
    ];
    for (const lang of ["en", "it"] as const) {
      const { pricing, plans, faq } = SITE_COPY[lang];
      const text = [
        pricing.meta.title,
        pricing.meta.description,
        pricing.title,
        pricing.line,
        pricing.compareTitle,
        pricing.featureColumn,
        pricing.included,
        pricing.notIncluded,
        ...Object.values(pricing.groups),
        ...Object.values(pricing.rows),
        ...Object.values(pricing.cells),
        pricing.faqTitle,
        ...pricing.faq.flatMap((f) => [f.q, f.a]),
        plans.title,
        plans.price,
        plans.compare,
        plans.recommended,
        ...plans.items.flatMap((i) => [i.name, i.line, ...i.items, i.action]),
        faq.title,
        ...faq.items.flatMap((f) => [f.q, f.a]),
      ].join("\n");
      for (const re of promises) expect(text, `${lang} ${re}`).not.toMatch(re);
    }
  });
});
