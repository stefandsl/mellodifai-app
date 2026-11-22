import { afterEach, expect, it, vi } from "vitest";

vi.mock("@playwright/test", () => ({
  defineConfig: (value: unknown) => value,
  devices: { "Desktop Chrome": {} },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function environment(ci = false) {
  vi.stubEnv("CI", ci ? "true" : "false");
  vi.stubEnv("E2E_ALLOW_LIVE_STACK", ci ? "1" : "");
  vi.stubEnv("E2E_PORT", ci ? "3210" : "3219");
  vi.stubEnv("SUPABASE_URL", `http://127.0.0.1:${ci ? 54321 : 45621}`);
  const db = `127.0.0.1:${ci ? 54322 : 45622}/postgres`;
  vi.stubEnv("TEST_DB_URL", `postgresql://postgres@${db}`);
  vi.stubEnv("MDF_WEB_DATABASE_URL", `postgresql://mdf_web@${db}`);
  vi.stubEnv("MDF_AUTH_DATABASE_URL", `postgresql://mdf_auth@${db}`);
  vi.stubEnv("MELLODIFAI_ROOT", "E:/mellodifai");
  vi.stubEnv("RUNNER_TEMP", ci ? "/tmp/mellodifai-ci" : "");
  // The config refuses to start without the fake worker; do not depend on
  // the shell that runs the unit suite.
  vi.stubEnv("WORKER_FAKE", "1");
  for (const name of ["TEMP", "TMP", "TMPDIR"])
    vi.stubEnv(name, "C:/Users/someone/AppData/Local/Temp");
}

it.each([false, true])(
  "starts the isolated three-server OAuth topology (CI=%s)",
  async (ci) => {
    environment(ci);
    const { default: config } = await import("../playwright.config");
    const servers = config.webServer;
    expect(Array.isArray(servers)).toBe(true);
    if (!Array.isArray(servers))
      throw new Error("Three webServer entries required");
    expect(servers.length).toBe(3);
    const [auth, proxy, next] = servers;
    for (const server of servers)
      for (const name of ["TEMP", "TMP", "TMPDIR"])
        expect(server.env?.[name]).toBe(
          ci ? "/tmp/mellodifai-ci" : "E:/mellodifai",
        );
    expect(next.url).toBe(`http://127.0.0.1:${ci ? 3210 : 3219}`);
    expect(next.env?.SITE_URL).toBe("http://127.0.0.1:3210");
    expect(auth.url).toBe(
      "http://127.0.0.1:3211/oauth/.well-known/openid-configuration",
    );
    expect(auth.env?.MDF_AUTH_ISSUER).toBe("http://127.0.0.1:3212/oauth");
    expect(auth.env?.PORT).toBe("3211");
    expect(auth.env?.MDF_AUTH_DATABASE_URL).toBe(
      process.env.MDF_AUTH_DATABASE_URL,
    );
    expect(auth.command).toContain(
      `secrets/auth/${ci ? "ci" : "e2e"}/auth.env`,
    );
    expect(proxy.url).toBe(
      "http://127.0.0.1:3212/.well-known/oauth-authorization-server/oauth",
    );
    expect(proxy.command).toContain("--mode local");
    expect(proxy.command).toContain(
      `--next http://127.0.0.1:${ci ? 3210 : 3219}`,
    );
    expect(proxy.command).toContain("--auth http://127.0.0.1:3211");
    expect(
      servers.every((server) => server.reuseExistingServer === false),
    ).toBe(true);
  },
);

it("refuses an auth connection to the live database before starting servers", async () => {
  environment();
  vi.stubEnv(
    "MDF_AUTH_DATABASE_URL",
    "postgresql://mdf_auth@127.0.0.1:54322/postgres",
  );
  const refused = await import("../playwright.config").then(
    () => false,
    () => true,
  );
  expect(refused).toBe(true);
});
