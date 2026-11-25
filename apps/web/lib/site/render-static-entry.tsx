import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompareTable } from "@/components/site/compare-table";
import { Faq } from "@/components/site/faq";
import { Home } from "@/components/site/home";
import { PricingPlans } from "@/components/site/pricing-plans";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SITE_COPY, type SiteLang } from "@/lib/site/copy";
import { COMPARE } from "@/lib/site/plans";
import { SiteHeading, SiteLink } from "@/src/site-primitives";
import { buildMinifiedPageCss } from "./site-static-css";

const THEME_INIT_SCRIPT =
  'try{if(localStorage.getItem("mellodifai-theme")==="light")document.documentElement.setAttribute("data-theme","light")}catch{}';

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderDocument(options: {
  lang: SiteLang;
  page: "home" | "pricing" | "recipes";
  title: string;
  description: string;
  extraHead?: string;
  extraCssClasses?: readonly string[];
  scripts: readonly string[];
  children: ReactNode;
}): { html: string; fontsCss: string } {
  const copy = SITE_COPY[options.lang];
  const bodyHtml = renderToStaticMarkup(
    <VStack className="site">
      <SiteLink href="#main" className="site-skip" color="inherit">
        {copy.skip}
      </SiteLink>
      <SiteHeader copy={copy} />
      <VStack as="main" id="main" className="site-main" tabIndex={-1}>
        {options.children}
      </VStack>
      <SiteFooter copy={copy} />
    </VStack>,
  );

  const { inlineCss, fontsCss } = buildMinifiedPageCss({
    page: options.page,
    bodyHtml,
    extraClasses: options.extraCssClasses,
  });

  const scriptTags = options.scripts
    .map(
      (src) =>
        `<script type="module" async fetchpriority="low" src="${src}"></script>`,
    )
    .join("");

  const html = [
    "<!DOCTYPE html>",
    `<html lang="${options.lang}" data-theme="dark" data-astryx-theme="mesh">`,
    "<head>",
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${escapeHtml(options.title)}</title>`,
    `<meta name="description" content="${escapeHtml(options.description)}"/>`,
    options.extraHead ?? "",
    '<link rel="icon" href="/favicon.ico" sizes="64x64" type="image/x-icon"/>',
    `<script>${THEME_INIT_SCRIPT}</script>`,
    `<style>${inlineCss}</style>`,
    '<noscript><link rel="stylesheet" href="/site/fonts.css"/></noscript>',
    "</head>",
    "<body>",
    bodyHtml,
    scriptTags,
    "</body>",
    "</html>",
  ].join("");

  return { html, fontsCss };
}

export function renderPricingStatic(lang: SiteLang): {
  html: string;
  fontsCss: string;
} {
  const copy = SITE_COPY[lang];
  const p = copy.pricing;
  return renderDocument({
    lang,
    page: "pricing",
    title: p.meta.title,
    description: p.meta.description,
    scripts: ["/site/islands/pricing.js"],
    children: (
      <>
        <PricingPlans copy={copy} />
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
              rows: g.rows.map((r) => ({
                label: p.rows[r.row],
                cells: r.cells,
              })),
            }))}
            cellText={(key) => p.cells[key]}
            included={p.included}
            notIncluded={p.notIncluded}
          />
        </VStack>
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
    ),
  });
}

export function renderHomeStatic(lang: SiteLang): {
  html: string;
  fontsCss: string;
} {
  const copy = SITE_COPY[lang];
  return renderDocument({
    lang,
    page: "home",
    title: copy.meta.title,
    description: copy.meta.description,
    // Keep Collapsible open-chevron rotation class available when toggled client-side.
    extraCssClasses: ["x19jd1h0"],
    scripts: ["/site/islands/home.js"],
    children: <Home copy={copy} />,
  });
}

export function renderAllStaticPages() {
  const pages: Record<string, string> = {};
  let fontsCss = "";
  for (const lang of ["en", "it"] as const) {
    const home = renderHomeStatic(lang);
    pages[`home-${lang}.html`] = home.html;
    const pricing = renderPricingStatic(lang);
    pages[`pricing-${lang}.html`] = pricing.html;
    if (!fontsCss) fontsCss = pricing.fontsCss;
  }
  return { pages, fontsCss };
}
