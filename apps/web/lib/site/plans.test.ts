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
});
