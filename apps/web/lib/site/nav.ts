// Links of the public site. Each page has its final route (MAPPING.md, section 2). While a page
// is not built yet (later tickets C03-C16), its link goes to the home section that covers the same
// thing, so no link of the site ends on a missing page. Ship a page: set `built: true`.

export type SiteRoute = { route: string; built: boolean; fallback: string };

export const ROUTES = {
  home: { route: "/", built: true, fallback: "/" },
  start: { route: "/create", built: true, fallback: "/create" },
  signIn: { route: "/login", built: true, fallback: "/login" },
  songbook: { route: "/recipes", built: true, fallback: "/#kinds" },
  desktop: { route: "/desktop", built: false, fallback: "/#studio" },
  agents: { route: "/agents", built: false, fallback: "/#agents" },
  plans: { route: "/pricing", built: true, fallback: "/#plans" },
  changelog: { route: "/changelog", built: true, fallback: "/#steps" },
  guides: { route: "/learn", built: false, fallback: "/#features" },
  support: { route: "/support", built: false, fallback: "/#faq" },
  privacy: { route: "/privacy", built: false, fallback: "/#faq" },
  terms: { route: "/terms", built: false, fallback: "/#faq" },
} as const satisfies Record<string, SiteRoute>;

export type RouteName = keyof typeof ROUTES;

export function href(name: RouteName): string {
  const r: SiteRoute = ROUTES[name];
  return r.built ? r.route : r.fallback;
}

export const AGENTS = [
  "claude",
  "chatgpt",
  "gemini",
  "codex",
  "cursor",
] as const;
export type AgentName = (typeof AGENTS)[number];

export function agentHref(agent: AgentName): string {
  return ROUTES.agents.built
    ? `${ROUTES.agents.route}?agent=${agent}`
    : ROUTES.agents.fallback;
}

// Recipe detail page (C06) is built and prerendered per published recipe slug.
const RECIPE_DETAIL_BUILT = true;

export function recipeHref(slug: string): string {
  const safe = encodeURIComponent(slug);
  return RECIPE_DETAIL_BUILT ? `/recipes/${safe}` : `/create?recipe=${safe}`;
}

export function recipeTryHref(slug: string): string {
  return `/recipes/${encodeURIComponent(slug)}/try`;
}

export function recipeStartHref(slug: string): string {
  return `/create?recipe=${encodeURIComponent(slug)}`;
}

// Header order: songbook, desktop, agents (menu), plans, what's new.
export const HEADER_LINKS = [
  "songbook",
  "desktop",
  "agents",
  "plans",
  "changelog",
] as const;
export const FOOTER_COLUMNS = [
  {
    head: "make",
    links: ["songbook", "desktop", "agents", "plans", "changelog"],
  },
  { head: "learn", links: ["guides", "support"] },
  { head: "legal", links: ["privacy", "terms"] },
] as const;
