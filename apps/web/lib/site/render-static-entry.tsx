import fs from "node:fs";
import path from "node:path";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMark } from "@/components/site/agent-switch";
import { AgentsPage } from "@/components/site/agents-page";
import { ChangelogPage } from "@/components/site/changelog-page";
import { ClosingBand } from "@/components/site/closing-band";
import { CompareTable } from "@/components/site/compare-table";
import { Faq } from "@/components/site/faq";
import { Home } from "@/components/site/home";
import {
  CloseGlyph,
  ExitFullscreenGlyph,
  FullscreenGlyph,
  PauseGlyph,
  PlayGlyph,
  VolumeGlyph,
  VolumeMuteGlyph,
} from "@/components/site/icons";
import { NotFoundBody } from "@/components/site/not-found-body";
import { PricingPlans } from "@/components/site/pricing-plans";
import { RecipeDetail } from "@/components/site/recipe-detail";
import {
  RecipesIndex,
  type RecipesViewMode,
} from "@/components/site/recipes-index";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { AGENTS, type AgentName, getAllAgentProfiles } from "@/lib/site/agents";
import type { ChangelogEntry } from "@/lib/site/changelog-types";
import { SITE_COPY, type SiteLang } from "@/lib/site/copy";
import { href } from "@/lib/site/nav";
import { COMPARE } from "@/lib/site/plans";
import type { RecipeIndexItem } from "@/lib/site/recipe-canvas-layout";
import {
  getMoreRecipes,
  getPublishedRecipes,
  type LoadedRecipe,
} from "@/lib/site/recipes";
import { getRecipeTestFixture } from "@/lib/site/recipes.fixture";
import { SiteHeading, SiteIcon, SiteLink } from "@/src/site-primitives";
import { buildMinifiedFontsCss, buildMinifiedPageCss } from "./site-static-css";

export type StaticAssetUrls = {
  fontsUrl: string;
  islandUrls: {
    home: string;
    pricing: string;
    recipes: string;
    "recipe-detail": string;
    changelog: string;
    agents: string;
  };
};

const DEFAULT_ASSET_URLS: StaticAssetUrls = {
  fontsUrl: "/site/styles/fonts.css",
  islandUrls: {
    home: "/site/islands/home.js",
    pricing: "/site/islands/pricing.js",
    recipes: "/site/islands/recipes.js",
    "recipe-detail": "/site/islands/recipe-detail.js",
    changelog: "/site/islands/changelog.js",
    agents: "/site/islands/agents.js",
  },
};

export function buildSiteFontsCss(): string {
  return buildMinifiedFontsCss();
}

const WEB_DIR =
  process.env.SITE_STATIC_WEB_DIR || path.resolve(import.meta.dirname, "../..");

const THEME_INIT_SCRIPT =
  'try{if(localStorage.getItem("mellodifai-theme")==="light")document.documentElement.setAttribute("data-theme","light")}catch{}';

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
  page:
    | "home"
    | "pricing"
    | "recipes"
    | "recipe-detail"
    | "changelog"
    | "agents"
    | "not-found";
  title: string;
  description: string;
  fontsUrl: string;
  extraHead?: string;
  extraBodyTail?: string;
  extraCssClasses?: readonly string[];
  scripts: readonly string[];
  deferScriptsUntilAfterLcp?: boolean;
  customBody?: ReactNode;
  children?: ReactNode;
}): { html: string; fontsCss: string; bodyHtml: string } {
  const copy = SITE_COPY[options.lang];
  const bodyHtml = renderToStaticMarkup(
    options.customBody ?? (
      <VStack className="site">
        <SiteLink href="#main" className="site-skip" color="inherit">
          {copy.skip}
        </SiteLink>
        <SiteHeader copy={copy} />
        <VStack as="main" id="main" className="site-main" tabIndex={-1}>
          {options.children}
        </VStack>
        <SiteFooter copy={copy} />
      </VStack>
    ),
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
    `<html lang="${options.lang}" data-theme="dark" data-astryx-theme="mesh" data-site-fonts-url="${escapeHtml(options.fontsUrl)}">`,
    "<head>",
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${escapeHtml(options.title)}</title>`,
    `<meta name="description" content="${escapeHtml(options.description)}"/>`,
    options.extraHead ?? "",
    // app/favicon.ico on every page: one cached request, off the LCP path.
    '<link rel="icon" href="/favicon.ico" sizes="64x64" type="image/x-icon"/>',
    `<script>${THEME_INIT_SCRIPT}</script>`,
    `<style>${inlineCss}</style>`,
    `<noscript><link rel="stylesheet" href="${escapeHtml(options.fontsUrl)}"/></noscript>`,
    "</head>",
    "<body>",
    fullBody,
    scriptTags,
    "</body>",
    "</html>",
  ].join("");

  return { html, fontsCss, bodyHtml: fullBody };
}

export function renderPricingStatic(
  lang: SiteLang,
  assets: StaticAssetUrls = DEFAULT_ASSET_URLS,
): {
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
    fontsUrl: assets.fontsUrl,
    scripts: [assets.islandUrls.pricing],
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

export type HomeAstryxStateClasses = {
  disabledButton: string[];
  panelClosed: string[];
  panelOpen: string[];
  chevronOpen: string[];
  chevronClosed: string[];
  chipPressed: string[];
  chipUnpressed: string[];
};

function extractElementClasses(markup: string, pattern: RegExp): Set<string> {
  const match = markup.match(pattern);
  if (!match) return new Set();
  const classMatch = match[0].match(/\bclass="([^"]*)"/u);
  if (!classMatch) return new Set();
  return new Set(classMatch[1].split(/\s+/u).filter(Boolean));
}

function diffClassSets(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((cls) => !b.has(cls));
}

let cachedHomeClasses: HomeAstryxStateClasses | null = null;

export function deriveHomeAstryxStateClasses(): HomeAstryxStateClasses {
  if (cachedHomeClasses) return cachedHomeClasses;

  const enabledBtn = renderToStaticMarkup(<Button label="x" />);
  const disabledBtn = renderToStaticMarkup(<Button label="x" isDisabled />);
  const enabledClasses = extractElementClasses(enabledBtn, /<button\b[^>]*>/u);
  const disabledClasses = extractElementClasses(
    disabledBtn,
    /<button\b[^>]*>/u,
  );

  const pressedToggle = renderToStaticMarkup(
    <ToggleButton label="x" isPressed={true} />,
  );
  const unpressedToggle = renderToStaticMarkup(
    <ToggleButton label="x" isPressed={false} />,
  );
  const pressedToggleClasses = extractElementClasses(
    pressedToggle,
    /<button\b[^>]*>/u,
  );
  const unpressedToggleClasses = extractElementClasses(
    unpressedToggle,
    /<button\b[^>]*>/u,
  );

  const closedCollapsible = renderToStaticMarkup(
    <Collapsible trigger="x" defaultIsOpen={false}>
      y
    </Collapsible>,
  );
  const openCollapsible = renderToStaticMarkup(
    <Collapsible trigger="x" defaultIsOpen={true}>
      y
    </Collapsible>,
  );

  const closedPanelClasses = extractElementClasses(
    closedCollapsible,
    /<div\b[^>]*\bastryx-collapsible-content\b[^>]*>/u,
  );
  const openPanelClasses = extractElementClasses(
    openCollapsible,
    /<div\b[^>]*\bastryx-collapsible-content\b[^>]*>/u,
  );

  const closedChevronClasses = extractElementClasses(
    closedCollapsible,
    /<span\b[^>]*\bastryx-icon\b[^>]*>/u,
  );
  const openChevronClasses = extractElementClasses(
    openCollapsible,
    /<span\b[^>]*\bastryx-icon\b[^>]*>/u,
  );

  cachedHomeClasses = {
    disabledButton: diffClassSets(disabledClasses, enabledClasses),
    panelClosed: diffClassSets(closedPanelClasses, openPanelClasses),
    panelOpen: diffClassSets(openPanelClasses, closedPanelClasses),
    chevronOpen: diffClassSets(openChevronClasses, closedChevronClasses),
    chevronClosed: diffClassSets(closedChevronClasses, openChevronClasses),
    chipPressed: diffClassSets(pressedToggleClasses, unpressedToggleClasses),
    chipUnpressed: diffClassSets(unpressedToggleClasses, pressedToggleClasses),
  };
  return cachedHomeClasses;
}

function renderHomeTemplates(stateClasses: HomeAstryxStateClasses): string {
  return `<script type="application/json" id="site-home-classes">${safeJsonForScript(stateClasses)}</script>`;
}

export function renderHomeStatic(
  lang: SiteLang,
  assets: StaticAssetUrls = DEFAULT_ASSET_URLS,
): {
  html: string;
  fontsCss: string;
} {
  const copy = SITE_COPY[lang];
  const stateClasses = deriveHomeAstryxStateClasses();
  const extraCssClasses = [
    ...stateClasses.disabledButton,
    ...stateClasses.panelClosed,
    ...stateClasses.panelOpen,
    ...stateClasses.chevronOpen,
    ...stateClasses.chevronClosed,
    ...stateClasses.chipPressed,
    ...stateClasses.chipUnpressed,
  ];
  return renderDocument({
    lang,
    page: "home",
    title: copy.meta.title,
    description: copy.meta.description,
    fontsUrl: assets.fontsUrl,
    extraBodyTail: renderHomeTemplates(stateClasses),
    extraCssClasses,
    scripts: [assets.islandUrls.home],
    children: <Home copy={copy} />,
  });
}

function renderRecipesClosingBand(lang: SiteLang): ReactNode {
  const copy = SITE_COPY[lang];
  return (
    <ClosingBand
      sectionIndex="2"
      titleId="recipes-close-title"
      title={copy.closing.title}
      primaryAction={{ label: copy.closing.action, href: href("start") }}
      note={copy.closing.note}
    />
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
  assets: StaticAssetUrls = DEFAULT_ASSET_URLS,
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
    fontsUrl: assets.fontsUrl,
    extraHead:
      '<link rel="alternate" type="text/markdown" href="/recipes.md"/>',
    extraBodyTail,
    extraCssClasses,
    scripts: [assets.islandUrls.recipes],
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

function renderRecipeDetailTemplates(): string {
  const icons = [
    ["play", PlayGlyph],
    ["pause", PauseGlyph],
    ["volume", VolumeGlyph],
    ["mute", VolumeMuteGlyph],
    ["fullscreen", FullscreenGlyph],
    ["exit-fullscreen", ExitFullscreenGlyph],
  ] as const;
  return icons
    .map(([name, Glyph]) => {
      const markup = renderToStaticMarkup(
        <SiteIcon icon={Glyph} size="sm" color="inherit" />,
      );
      return `<template data-clip-icon="${name}">${markup}</template>`;
    })
    .join("");
}

export function renderRecipeDetailStatic(
  recipe: LoadedRecipe,
  lang: SiteLang,
  assets: StaticAssetUrls = DEFAULT_ASSET_URLS,
): { html: string; fontsCss: string; bodyHtml: string } {
  const copy = SITE_COPY[lang];
  const title = `${recipe.title[lang]} - MellodifAI`;
  const description = recipe.summary[lang];
  const moreRecipes = getMoreRecipes(recipe.slug, 12);
  const heroCoverSrc = coverToDataUri(recipe.mediaUrls.cover);

  return renderDocument({
    lang,
    page: "recipe-detail",
    title,
    description,
    fontsUrl: assets.fontsUrl,
    extraBodyTail: renderRecipeDetailTemplates(),
    scripts: [assets.islandUrls["recipe-detail"]],
    deferScriptsUntilAfterLcp: true,
    children: (
      <RecipeDetail
        recipe={recipe}
        moreRecipes={moreRecipes}
        heroCoverSrc={heroCoverSrc}
        lang={lang}
        copy={copy}
      />
    ),
  });
}

export function renderChangelogStatic(
  entries: readonly ChangelogEntry[],
  lang: SiteLang,
  assets: StaticAssetUrls = DEFAULT_ASSET_URLS,
): { html: string; fontsCss: string; bodyHtml: string } {
  if (entries.length === 0) {
    throw new Error(
      "renderChangelogStatic: changelog entries must not be empty",
    );
  }
  const copy = SITE_COPY[lang];
  return renderDocument({
    lang,
    page: "changelog",
    title: copy.changelog.meta.title,
    description: copy.changelog.meta.description,
    fontsUrl: assets.fontsUrl,
    scripts: [assets.islandUrls.changelog],
    children: <ChangelogPage entries={entries} lang={lang} copy={copy} />,
  });
}

function renderAgentsTemplates(agent: AgentName, lang: SiteLang): string {
  const copy = SITE_COPY[lang].agents;
  const profiles = getAllAgentProfiles(lang);
  const markTemplates = AGENTS.map((id) => {
    const markup = renderToStaticMarkup(
      <AgentMark agent={id} className="site-agents-hero__mark" />,
    );
    return `<template data-agent-mark="${id}">${markup}</template>`;
  }).join("");
  const payload = {
    activeAgent: agent,
    profiles,
    copy: {
      copyButton: copy.copyButton,
      copiedButton: copy.copiedButton,
      copyStatus: copy.copiedStatus,
      copyFailed: copy.copyFailedStatus,
      switchedStatus: copy.agentSelectedStatus,
    },
  };
  return `${markTemplates}<script type="application/json" id="site-agents-data">${safeJsonForScript(payload)}</script>`;
}

export function renderAgentsStatic(
  agent: AgentName,
  lang: SiteLang,
  assets: StaticAssetUrls = DEFAULT_ASSET_URLS,
): { html: string; fontsCss: string; bodyHtml: string } {
  const copy = SITE_COPY[lang];
  return renderDocument({
    lang,
    page: "agents",
    title: copy.agents.meta.title,
    description: copy.agents.meta.description,
    fontsUrl: assets.fontsUrl,
    extraBodyTail: renderAgentsTemplates(agent, lang),
    scripts: [assets.islandUrls.agents],
    children: <AgentsPage agent={agent} lang={lang} copy={copy} />,
  });
}

export function renderNotFoundStatic(
  lang: SiteLang,
  assets: StaticAssetUrls = DEFAULT_ASSET_URLS,
): { html: string; fontsCss: string; bodyHtml: string } {
  const copy = SITE_COPY[lang];
  return renderDocument({
    lang,
    page: "not-found",
    title: copy.notFound.meta.title,
    description: copy.notFound.meta.description,
    fontsUrl: assets.fontsUrl,
    scripts: [],
    customBody: <NotFoundBody copy={copy} />,
  });
}

export function renderAllStaticPages(
  assets: StaticAssetUrls,
  changelogEntries: readonly ChangelogEntry[],
) {
  if (!Array.isArray(changelogEntries) || changelogEntries.length === 0) {
    throw new Error(
      "renderAllStaticPages: changelogEntries is required and must be non-empty",
    );
  }
  const pages: Record<string, string> = {};
  let fontsCss = "";
  const publishedRecipes = getPublishedRecipes();

  for (const lang of ["en", "it"] as const) {
    const home = renderHomeStatic(lang, assets);
    pages[`home-${lang}.html`] = home.html;

    const pricing = renderPricingStatic(lang, assets);
    pages[`pricing-${lang}.html`] = pricing.html;
    if (!fontsCss) fontsCss = pricing.fontsCss;

    const changelog = renderChangelogStatic(changelogEntries, lang, assets);
    pages[`changelog-${lang}.html`] = changelog.html;

    for (const agent of AGENTS) {
      const agentsPage = renderAgentsStatic(agent, lang, assets);
      pages[`agents-${agent}-${lang}.html`] = agentsPage.html;
    }

    const notFound = renderNotFoundStatic(lang, assets);
    pages[`not-found-${lang}.html`] = notFound.html;

    for (const view of ["canvas", "grid"] as const) {
      const regular = renderRecipesStatic(lang, view, false, [], assets);
      pages[`recipes-${view}-${lang}.html`] = regular.html;

      const fix24 = renderRecipesStatic(lang, view, true, [], assets);
      pages[`recipes-${view}-24-${lang}.html`] = fix24.html;
    }

    for (const recipe of publishedRecipes) {
      const detail = renderRecipeDetailStatic(recipe, lang, assets);
      pages[`recipe-${recipe.slug}-${lang}.html`] = detail.html;
    }
  }
  return { pages, fontsCss };
}
