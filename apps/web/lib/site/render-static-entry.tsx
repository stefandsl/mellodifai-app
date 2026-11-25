import fs from "node:fs";
import path from "node:path";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Cover, type CoverKind } from "@/components/site/art";
import { CompareTable } from "@/components/site/compare-table";
import { Faq } from "@/components/site/faq";
import { Home } from "@/components/site/home";
import { ArrowGlyph, CloseGlyph } from "@/components/site/icons";
import { PricingPlans } from "@/components/site/pricing-plans";
import {
  RecipesIndex,
  type RecipesViewMode,
} from "@/components/site/recipes-index";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SITE_COPY, type SiteLang } from "@/lib/site/copy";
import { href } from "@/lib/site/nav";
import { COMPARE } from "@/lib/site/plans";
import type { RecipeIndexItem } from "@/lib/site/recipe-canvas-layout";
import { getPublishedRecipes, type LoadedRecipe } from "@/lib/site/recipes";
import { getRecipeTestFixture } from "@/lib/site/recipes.fixture";
import {
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";
import { buildMinifiedPageCss } from "./site-static-css";

const WEB_DIR = path.resolve(import.meta.dirname, "../..");

const THEME_INIT_SCRIPT =
  'try{if(localStorage.getItem("mellodifai-theme")==="light")document.documentElement.setAttribute("data-theme","light")}catch{}';

const CLOSING_ART: CoverKind[] = [
  "remix",
  "cover",
  "satire",
  "translation",
  "karaoke",
  "video",
];

// Ring 1 covers (slots 0..11) are tiny 2-4 KB JPEGs. Inlining them on canvas SSR avoids
// saturating HTTP/1.1 connection slots on Slow 4G and paints the LCP cover synchronously.
const CANVAS_INLINE_COVER_COUNT = 12;

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function collectAllClasses(html: string): string[] {
  const out = new Set<string>();
  for (const attr of html.matchAll(/\bclass="([^"]*)"/gu)) {
    for (const cls of attr[1].split(/\s+/u)) {
      if (cls) out.add(cls);
    }
  }
  return [...out];
}

function toRecipeIndexItem(recipe: LoadedRecipe): RecipeIndexItem {
  return {
    id: recipe.id,
    slug: recipe.slug,
    kind: recipe.kind,
    title: recipe.title,
    summary: recipe.summary,
    highlights: recipe.highlights,
    genre: recipe.genre,
    tempo: recipe.tempo,
    languages: recipe.languages,
    output: recipe.output,
    format: recipe.format,
    featured: recipe.featured,
    media: {
      preview: recipe.media.preview,
      startAt: recipe.media.startAt,
    },
    mediaUrls: {
      cover: recipe.mediaUrls.cover,
      preview: recipe.mediaUrls.preview,
    },
    targets: recipe.targets,
  };
}

const dataUriCache = new Map<string, string>();
function coverToDataUri(coverUrl: string): string {
  const cached = dataUriCache.get(coverUrl);
  if (cached) return cached;
  if (!coverUrl.startsWith("/site/")) return coverUrl;
  const filePath = path.join(WEB_DIR, "public", coverUrl);
  if (!fs.existsSync(filePath)) return coverUrl;
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";
  const uri = `data:${mime};base64,${buf.toString("base64")}`;
  dataUriCache.set(coverUrl, uri);
  return uri;
}

function renderDocument(options: {
  lang: SiteLang;
  page: "home" | "pricing" | "recipes";
  title: string;
  description: string;
  extraHead?: string;
  extraBodyTail?: string;
  extraCssClasses?: readonly string[];
  scripts: readonly string[];
  deferScriptsUntilAfterLcp?: boolean;
  children: ReactNode;
}): { html: string; fontsCss: string; bodyHtml: string } {
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

  const fullBody = `${bodyHtml}${options.extraBodyTail ?? ""}`;

  const { inlineCss, fontsCss } = buildMinifiedPageCss({
    page: options.page,
    bodyHtml: fullBody,
    extraClasses: options.extraCssClasses,
  });

  const scriptTags = options.deferScriptsUntilAfterLcp
    ? `<script>(function(){var d=0,u=${JSON.stringify(options.scripts)},r=function(){if(d)return;d=1;for(var i=0;i<u.length;i++){var s=document.createElement("script");s.type="module";s.src=u[i];document.body.appendChild(s)}};try{if(typeof PerformanceObserver!=="undefined"&&PerformanceObserver.supportedEntryTypes&&PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint")){var o=new PerformanceObserver(function(l){if(l.getEntries().length){o.disconnect();requestAnimationFrame(function(){requestAnimationFrame(r)})}});o.observe({type:"largest-contentful-paint",buffered:true});setTimeout(r,400);return}}catch(e){}requestAnimationFrame(function(){setTimeout(r,0)})})()</script>`
    : options.scripts
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
    '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%278%27 fill=%27%2307070a%27/%3E%3Ccircle cx=%2716%27 cy=%2716%27 r=%277%27 fill=%27%23f2333d%27/%3E%3C/svg%3E" type="image/svg+xml"/>',
    `<script>${THEME_INIT_SCRIPT}</script>`,
    `<style>${inlineCss}</style>`,
    '<noscript><link rel="stylesheet" href="/site/fonts.css"/></noscript>',
    "</head>",
    "<body>",
    fullBody,
    scriptTags,
    "</body>",
    "</html>",
  ].join("");

  return { html, fontsCss, bodyHtml: fullBody };
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

function renderRecipesClosingBand(lang: SiteLang): ReactNode {
  const copy = SITE_COPY[lang];
  return (
    <VStack
      as="section"
      className="site-close"
      data-ref-section="2"
      aria-labelledby="recipes-close-title"
    >
      <VStack className="site-close__band">
        <HStack className="site-close__mosaic" aria-hidden="true">
          {CLOSING_ART.map((k) => (
            <Cover key={k} kind={k} className="site-close__cover" />
          ))}
        </HStack>
        <VStack
          className="site-close__column"
          data-ref-content
          gap={8}
          hAlign="center"
        >
          <SiteHeading
            level={2}
            id="recipes-close-title"
            type="display-2"
            justify="center"
            className="site-close__title"
          >
            {copy.closing.title}
          </SiteHeading>
          <SiteButtonLink
            label={copy.closing.action}
            href={href("start")}
            variant="primary"
            size="lg"
            icon={<SiteIcon icon={ArrowGlyph} size="sm" color="inherit" />}
          />
          <SiteText type="supporting" color="secondary" justify="center">
            {copy.closing.note}
          </SiteText>
        </VStack>
      </VStack>
    </VStack>
  );
}

function renderRecipesTemplates(lang: SiteLang): string {
  const r = SITE_COPY[lang].recipes;
  const emptyMarkup = renderToStaticMarkup(
    <VStack
      role="status"
      aria-live="polite"
      className="site-recipes-empty"
      gap={2}
      hAlign="center"
      data-canvas-ui="true"
      data-recipes-empty="true"
    >
      <Text weight="medium">{r.empty}</Text>
      <Text type="supporting" color="secondary">
        {r.emptyHint}
      </Text>
      <Button label={r.resetSearch} variant="secondary" size="sm" />
    </VStack>,
  );
  const clearMarkup = renderToStaticMarkup(
    <IconButton
      label={r.clearSearch}
      icon={<Icon icon={CloseGlyph} size="sm" color="inherit" />}
      variant="ghost"
      size="sm"
    />,
  );
  const captionMarkup = renderToStaticMarkup(
    <>
      <Text weight="medium"> </Text>
      <Text type="supporting" color="secondary" maxLines={2}>
        {" "}
      </Text>
    </>,
  );
  return [
    `<template data-recipes-empty-tpl="true">${emptyMarkup}</template>`,
    `<template data-recipes-clear-tpl="true">${clearMarkup}</template>`,
    `<template data-recipes-caption-tpl="true">${captionMarkup}</template>`,
  ].join("");
}

export function renderRecipesStatic(
  lang: SiteLang,
  view: RecipesViewMode,
  fixture24: boolean,
  extraCssClasses: readonly string[] = [],
): { html: string; fontsCss: string; bodyHtml: string } {
  const copy = SITE_COPY[lang];
  const loaded = fixture24 ? getRecipeTestFixture() : getPublishedRecipes();
  const plainRecipes = loaded.map(toRecipeIndexItem);

  const ssrRecipes =
    view === "canvas"
      ? plainRecipes.map((item, idx) =>
          idx < CANVAS_INLINE_COVER_COUNT
            ? {
                ...item,
                mediaUrls: {
                  ...item.mediaUrls,
                  cover: coverToDataUri(item.mediaUrls.cover),
                },
              }
            : item,
        )
      : plainRecipes;

  const payload = {
    recipes: plainRecipes,
    lang,
    initialView: view,
    fixtureParam: fixture24 ? "24" : undefined,
    copy: copy.recipes,
  };

  const extraBodyTail = [
    renderRecipesTemplates(lang),
    `<script type="application/json" id="site-recipes-data">${safeJsonForScript(payload)}</script>`,
  ].join("");

  return renderDocument({
    lang,
    page: "recipes",
    title: copy.recipes.meta.title,
    description: copy.recipes.meta.description,
    extraHead:
      '<link rel="alternate" type="text/markdown" href="/recipes.md"/>',
    extraBodyTail,
    extraCssClasses,
    scripts: ["/site/islands/recipes.js"],
    deferScriptsUntilAfterLcp: true,
    children: (
      <RecipesIndex
        recipes={ssrRecipes}
        initialView={view}
        fixtureParam={fixture24 ? "24" : undefined}
        lang={lang}
        copy={copy.recipes}
        closingBand={renderRecipesClosingBand(lang)}
      />
    ),
  });
}

export function renderAllStaticPages() {
  const pages: Record<string, string> = {};
  let fontsCss = "";

  // Collect union of CSS classes used by both canvas and grid views so in-place view switches
  // have every Astryx and site.css rule immediately available without reloading styles.
  const canvasProbe = renderRecipesStatic("en", "canvas", false);
  const gridProbe = renderRecipesStatic("en", "grid", false);
  const recipesUnionClasses = [
    ...new Set([
      ...collectAllClasses(canvasProbe.bodyHtml),
      ...collectAllClasses(gridProbe.bodyHtml),
    ]),
  ];

  for (const lang of ["en", "it"] as const) {
    const home = renderHomeStatic(lang);
    pages[`home-${lang}.html`] = home.html;

    const pricing = renderPricingStatic(lang);
    pages[`pricing-${lang}.html`] = pricing.html;
    if (!fontsCss) fontsCss = pricing.fontsCss;

    for (const view of ["canvas", "grid"] as const) {
      const regular = renderRecipesStatic(
        lang,
        view,
        false,
        recipesUnionClasses,
      );
      pages[`recipes-${view}-${lang}.html`] = regular.html;

      const fix24 = renderRecipesStatic(lang, view, true, recipesUnionClasses);
      pages[`recipes-${view}-24-${lang}.html`] = fix24.html;
    }
  }
  return { pages, fontsCss };
}
