import "@/src/site-astryx-table.css";
import "@/components/site/parts.css";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { Metadata } from "next";
import { CompareTable } from "@/components/site/compare-table";
import { Faq } from "@/components/site/faq";
import { PricingPlans } from "@/components/site/pricing-plans";
import { getLocale } from "@/lib/locale";
import { SITE_COPY } from "@/lib/site/copy";
import { COMPARE } from "@/lib/site/plans";
import { SiteHeading } from "@/src/site-primitives";

// The pricing page (STUDY.md "Pricing"): head with the period switch, four plan cards, the
// compare table and the questions. Each block carries `data-ref-section` with the index of the
// reference section, for the likeness judge. Prices are the owner's decision (D1).
export async function generateMetadata(): Promise<Metadata> {
  const copy = SITE_COPY[await getLocale()];
  return {
    title: copy.pricing.meta.title,
    description: copy.pricing.meta.description,
  };
}

export default async function PricingPage() {
  const copy = SITE_COPY[await getLocale()];
  const p = copy.pricing;
  return (
    <>
      <PricingPlans copy={copy} />

      {/* 2. Compare table: five groups, four plan columns */}
      <VStack
        as="section"
        className="site-price-compare"
        data-ref-section="2"
        aria-labelledby="compare-title"
        gap={6}
      >
        <SiteHeading
          level={2}
          id="compare-title"
          className="site-price-compare__title"
        >
          {p.compareTitle}
        </SiteHeading>
        <CompareTable
          labelledBy="compare-title"
          featureColumn={p.featureColumn}
          columns={copy.plans.items.map((plan) => ({
            name: plan.name,
            price: copy.plans.price,
          }))}
          groups={COMPARE.map((g) => ({
            label: p.groups[g.group],
            rows: g.rows.map((r) => ({ label: p.rows[r.row], cells: r.cells })),
          }))}
          cellText={(key) => p.cells[key]}
          included={p.included}
          notIncluded={p.notIncluded}
        />
      </VStack>

      {/* 3. FAQ: title left, questions right */}
      <HStack
        as="section"
        id="faq"
        className="site-faq"
        data-ref-section="3"
        data-ref-grid
        aria-labelledby="pricing-faq-title"
      >
        <SiteHeading
          level={2}
          id="pricing-faq-title"
          className="site-title site-faq__title"
        >
          {p.faqTitle}
        </SiteHeading>
        <Faq items={p.faq} />
      </HStack>
    </>
  );
}
