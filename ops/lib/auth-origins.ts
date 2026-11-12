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

// Shared by bearer resolution, protected-resource metadata and the auth service.
export function mcpResource(siteUrl: string | undefined): string {
  // Dev exposes PAT-only MCP without an OAuth service.
  if (siteUrl === AUTH_ORIGINS.dev.siteUrl)
    return new URL("/api/mcp", siteUrl).href;
  const env = Object.values(AUTH_ORIGINS).find(
    (value) => value.siteUrl === siteUrl,
  );
  if (!env?.issuer)
    throw new Error("SITE_URL must select an OAuth stack origin");
  return new URL("/api/mcp", env.issuer).href;
}
