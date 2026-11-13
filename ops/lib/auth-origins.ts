// Shared by stack rendering and Next without importing filesystem tooling into Next.
export const AUTH_ORIGINS = {
  dev: {
    issuer: null,
    siteUrl: "http://127.0.0.1:3001",
    redirectUrls: ["http://127.0.0.1:3001/**", "http://localhost:3001/**"],
  },
  e2e: {
    issuer: "http://127.0.0.1:3212/oauth",
    siteUrl: "http://127.0.0.1:3210",
    redirectUrls: ["http://127.0.0.1:3210/**", "http://127.0.0.1:3212/**"],
  },
  ci: {
    issuer: "http://127.0.0.1:3212/oauth",
    siteUrl: "http://127.0.0.1:3210",
    redirectUrls: ["http://127.0.0.1:3210/**", "http://127.0.0.1:3212/**"],
  },
  // The Windows desktop app: one owner, PAT-only MCP, no OAuth service.
  desktop: {
    issuer: null,
    siteUrl: "http://127.0.0.1:46300",
    redirectUrls: ["http://127.0.0.1:46300/**", "http://localhost:46300/**"],
  },
  prod: {
    issuer: "https://app.mellodifai.com/oauth",
    siteUrl: "https://app.mellodifai.com",
    redirectUrls: [
      "https://app.mellodifai.com/**",
      "http://127.0.0.1:3000/**",
      "http://localhost:3000/**",
    ],
  },
};

// Stacks whose worker runs the owner's real (paid) engines. Tests never target them.
export const OWNER_STACK_PORTS = ["44321", "44322", "46321", "46322"];

/** Dev and the desktop app expose PAT-only MCP without an OAuth service. */
export function patOnlySite(siteUrl: string | undefined): boolean {
  return (
    siteUrl === AUTH_ORIGINS.dev.siteUrl ||
    siteUrl === AUTH_ORIGINS.desktop.siteUrl
  );
}

// Shared by bearer resolution, protected-resource metadata and the auth service.
export function mcpResource(siteUrl: string | undefined): string {
  if (patOnlySite(siteUrl)) return new URL("/api/mcp", siteUrl).href;
  const env = Object.values(AUTH_ORIGINS).find(
    (value) => value.siteUrl === siteUrl,
  );
  if (!env?.issuer)
    throw new Error("SITE_URL must select an OAuth stack origin");
  return new URL("/api/mcp", env.issuer).href;
}
