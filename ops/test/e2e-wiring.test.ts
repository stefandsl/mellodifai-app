import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("shares the isolated edge override across issuer, redirects and MCP audience", async () => {
  vi.stubEnv("E2E_EDGE_PORT", "3236");
  const { AUTH_ORIGINS, mcpResource } = await import("../lib/auth-origins.js");
  for (const env of ["e2e", "ci"] as const) {
    expect(AUTH_ORIGINS[env].issuer).toBe("http://127.0.0.1:3236/oauth");
    expect(AUTH_ORIGINS[env].redirectUrls).toContain(
      "http://127.0.0.1:3236/**",
    );
    expect(mcpResource(AUTH_ORIGINS[env].siteUrl)).toBe(
      "http://127.0.0.1:3236/api/mcp",
    );
  }
  expect(AUTH_ORIGINS.prod.issuer).toBe("https://app.mellodifai.com/oauth");
});

it.each(["abc", "3236/path", "65536", "0"])(
  "refuses invalid edge port %s",
  async (port) => {
    vi.stubEnv("E2E_EDGE_PORT", port);
    await expect(import("../lib/auth-origins.js")).rejects.toThrow(
      "Invalid E2E_EDGE_PORT",
    );
  },
);
