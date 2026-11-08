import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ENV_TABLE, IMAGE_PINS, runtimePath, stackDir } from "../lib/envs.js";
import { prepareStackDir, renderConfig } from "../lib/render.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const base = readFileSync(join(repo, "supabase/config.toml"), "utf8");
it("the template renders RedirectTo, TokenHash and the 6-digit Token", () => {
  const template = readFileSync(
    join(repo, "supabase/templates/magic_link.html"),
    "utf8",
  );
  const rendered = template
    .replaceAll(
      "{{ .RedirectTo }}",
      "http://localhost:3001/auth/confirm?next=%2Fcreate",
    )
    .replaceAll("{{ .TokenHash }}", "test-hash")
    .replaceAll("{{ .Token }}", "123456");
  expect(rendered).toContain(
    "http://localhost:3001/auth/confirm?next=%2Fcreate&token_hash=test-hash&type=email",
  );
  expect(rendered).toContain("123456");
});

it.each(["dev", "e2e", "ci", "prod"] as const)(
  "%s config selects the sign-in template",
  (env) => {
    expect(rendered(env).auth.email.template?.magic_link.content_path).toBe(
      "./compose/templates/magic_link.html",
    );
  },
);
let root = "";
let dir: string;
beforeEach(() => {
  root = "";
  const tmp = runtimePath(process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp");
  mkdirSync(tmp, { recursive: true });
  root = mkdtempSync(join(tmp, "render-test-"));
  dir = join(root, "stacks/e2e");
  vi.stubEnv("MELLODIFAI_ROOT", root);
  vi.stubEnv("RUNNER_TEMP", join(root, "runner"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
});

// Typed only at the test boundary so assertions remain about parsed TOML.
function rendered(env: keyof typeof ENV_TABLE, input = base) {
  return parse(renderConfig(input, env, dir)) as {
    project_id: string;
    api: { port: number; schemas: string[] };
    db: {
      port: number;
      shadow_port: number;
      pooler: { enabled: boolean; port: number };
      seed: { sql_paths: string[] };
    };
    studio: { enabled: boolean; port?: number };
    local_smtp: {
      enabled: boolean;
      port?: number;
      smtp_port?: number;
      pop3_port?: number;
    };
    analytics: { enabled: boolean; port?: number };
    edge_runtime: { inspector_port: number };
    auth: {
      site_url: string;
      additional_redirect_urls: string[];
      jwt_secret?: string;
      signing_keys_path: string;
      enable_signup: boolean;
      sessions: Record<string, string>;
      rate_limit: { email_sent: number };
      email: { template?: { magic_link: { content_path: string } } };
    };
  };
}

it("prod keeps project mellodifai on 44321/44322 and turns Studio, mail catcher and analytics off", () => {
  const t = rendered("prod");
  expect(t.project_id).toBe("mellodifai");
  expect([t.api.port, t.db.port]).toEqual([44321, 44322]);
  // CLI 3.0.0 rejects inbucket; Spike 2 verified local_smtp is its replacement.
  expect([t.studio.enabled, t.local_smtp.enabled, t.analytics.enabled]).toEqual(
    [false, false, false],
  );
  expect(t.auth.jwt_secret).toBe("env(MDF_SUPABASE_JWT_SECRET)");
  expect(t.auth.rate_limit.email_sent).toBe(30);
  expect(t.auth.sessions).toEqual({
    timebox: "168h",
    inactivity_timeout: "24h",
  });
  expect(t.auth.site_url).toBe("https://app.mellodifai.com");
  expect(t.auth.additional_redirect_urls).toEqual([
    "https://app.mellodifai.com/**",
    "http://127.0.0.1:3000/**",
    "http://localhost:3000/**",
  ]);
  expect(ENV_TABLE.prod.issuer).toBe("https://app.mellodifai.com/oauth");
  expect(ENV_TABLE.prod.smtp).toBe("owner");
  expect(ENV_TABLE.prod.fakeStack).toBe(false);
});

it("dev is mellodifai_dev on 55321-55327 with SITE_URL 127.0.0.1:3001", () => {
  const t = rendered("dev");
  expect(t.project_id).toBe("mellodifai_dev");
  expect([
    t.api.port,
    t.db.port,
    t.studio.port,
    t.local_smtp.port,
    t.analytics.port,
  ]).toEqual([55321, 55322, 55323, 55324, 55327]);
  expect(t.auth.site_url).toBe("http://127.0.0.1:3001");
  expect(t.auth.additional_redirect_urls).toEqual([
    "http://127.0.0.1:3001/**",
    "http://localhost:3001/**",
  ]);
  expect(ENV_TABLE.dev.issuer).toBeNull();
  expect(ENV_TABLE.dev.fakeStack).toBe(false);
});

it.each(["e2e", "ci"] as const)(
  "%s has its exact project, ports, redirects and issuer",
  (env) => {
    const t = rendered(env);
    expect(t.project_id).toBe(`mellodifai_${env}`);
    expect([
      t.api.port,
      t.db.port,
      t.studio.port,
      t.local_smtp.port,
      t.analytics.port,
    ]).toEqual(
      env === "e2e"
        ? [45621, 45622, 45623, 45624, 45627]
        : [54321, 54322, 54323, 54324, 54327],
    );
    expect([
      t.studio.enabled,
      t.local_smtp.enabled,
      t.analytics.enabled,
    ]).toEqual([true, true, true]);
    expect(t.auth.site_url).toBe("http://127.0.0.1:3210");
    expect(t.auth.additional_redirect_urls).toEqual([
      "http://127.0.0.1:3210/**",
      "http://127.0.0.1:3212/**",
    ]);
    expect(ENV_TABLE[env].issuer).toBe("http://127.0.0.1:3212/oauth");
    expect(ENV_TABLE[env].fakeStack).toBe(true);
    expect(ENV_TABLE[env].smtp).toBe("catcher");
    expect(t.auth.jwt_secret).toBeUndefined();
    expect(t.auth.sessions).toEqual({});
    expect(t.auth.rate_limit.email_sent).toBe(2);
  },
);

it("signing keys are outside the checkout and stacks, including dynamic runtime roots", () => {
  for (const env of ["dev", "e2e", "ci", "prod"] as const) {
    const expected =
      env === "ci"
        ? join(root, "runner/signing_keys.json")
        : join(
            root,
            "secrets/supabase",
            env === "prod" ? "" : env,
            "signing_keys.json",
          );
    expect(resolve(rendered(env).auth.signing_keys_path)).toBe(
      resolve(expected),
    );
    expect(resolve(ENV_TABLE[env].signingKeysPath)).toBe(resolve(expected));
  }
  vi.stubEnv("MELLODIFAI_ROOT", join(root, "changed"));
  expect(stackDir("dev")).toBe(join(root, "changed/stacks/dev"));
  expect(stackDir("ci")).toBe(join(root, "runner/stack"));
  vi.stubEnv("RUNNER_TEMP", "");
  expect(() => stackDir("ci")).toThrow(/RUNNER_TEMP/);
});

it("isolates every configured listener and removes optional SMTP listeners", () => {
  const input = base.replace(
    "[local_smtp]",
    "[local_smtp]\nsmtp_port = 54325\npop3_port = 54326",
  );
  for (const [env, shadow, inspector, pooler] of [
    ["dev", 55320, 55328, 55329],
    ["e2e", 45620, 45628, 45629],
    ["ci", 54320, 54328, 54329],
    ["prod", 44326, 44328, 44329],
  ] as const) {
    const t = rendered(env, input);
    expect([
      t.db.shadow_port,
      t.edge_runtime.inspector_port,
      t.db.pooler.port,
    ]).toEqual([shadow, inspector, pooler]);
    expect(t.db.pooler.enabled).toBe(false);
    expect(t.local_smtp.smtp_port).toBeUndefined();
    expect(t.local_smtp.pop3_port).toBeUndefined();
    expect(t.auth.enable_signup).toBe(false);
    expect(t.api.schemas).toEqual(["public", "graphql_public", "ops"]);
  }
});

it("links sources and stages a template inside the stack root for CLI 3", () => {
  const source = join(root, "source");
  mkdirSync(join(source, "supabase/migrations"), { recursive: true });
  mkdirSync(join(source, "supabase/templates"), { recursive: true });
  writeFileSync(join(source, "supabase/seed.sql"), "select 1;");
  writeFileSync(
    join(source, "supabase/templates/magic_link.html"),
    "{{ .RedirectTo }}",
  );
  prepareStackDir(dir, source);
  prepareStackDir(dir, source);
  const t = rendered(
    "e2e",
    `${base}\n[auth.email.template.magic_link]\ncontent_path = "./supabase/templates/magic_link.html"\n`,
  );
  expect(realpathSync(join(dir, "supabase/migrations"))).toBe(
    realpathSync(join(source, "supabase/migrations")),
  );
  expect(realpathSync(join(dir, "supabase/templates"))).toBe(
    realpathSync(join(source, "supabase/templates")),
  );
  expect(
    realpathSync(
      resolve(dir, t.auth.email.template?.magic_link.content_path ?? ""),
    ),
  ).toBe(resolve(dir, "compose/templates/magic_link.html"));
  expect(
    readFileSync(
      resolve(dir, "supabase", t.db.seed.sql_paths[0] ?? ""),
      "utf8",
    ),
  ).toBe("select 1;");
  expect(
    readFileSync(
      resolve(dir, t.auth.email.template?.magic_link.content_path ?? ""),
      "utf8",
    ),
  ).toBe("{{ .RedirectTo }}");
});

it("pins the supported CLI version files and records all exact compose image tags", () => {
  prepareStackDir(dir);
  expect(IMAGE_PINS).toEqual({
    postgres: "17.11.0.006",
    storage: "v1.84.19",
    rest: "v16.5",
    gotrue: "v2.197.0",
    realtime: "v2.147.1",
    pgmeta: "v0.100.0",
    studio: "2026.10.19-sha-b375769",
    "edge-runtime": "v1.77.8",
    mailpit: "v1.31.3",
    kong: "2.8.1",
    vector: "0.58.0-alpine",
    logflare: "1.50.15",
  });
  for (const service of [
    "postgres",
    "storage",
    "rest",
    "gotrue",
    "realtime",
    "pgmeta",
    "studio",
    "edge-runtime",
    "logflare",
  ] as const) {
    expect(
      readFileSync(join(dir, "supabase/.temp", `${service}-version`), "utf8"),
    ).toBe(IMAGE_PINS[service]);
  }
});

it("does not overwrite pre-existing stack source files", () => {
  mkdirSync(join(dir, "supabase/migrations"), { recursive: true });
  writeFileSync(join(dir, "supabase/migrations/owner.sql"), "select 1;");
  expect(() => prepareStackDir(dir)).toThrow(/existing/i);
  expect(readFileSync(join(dir, "supabase/migrations/owner.sql"), "utf8")).toBe(
    "select 1;",
  );
});

it("refuses a supabase directory junction back into the checkout before writing", () => {
  mkdirSync(dir, { recursive: true });
  symlinkSync(
    join(repo, "supabase"),
    join(dir, "supabase"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => prepareStackDir(dir)).toThrow(/checkout|C:/i);
});

it("rejects runtime paths on C or inside the checkout", () => {
  expect(() => renderConfig(base, "dev", "C:/unsafe-stack")).toThrow(
    /runtime|C:/i,
  );
  expect(() => prepareStackDir(join(repo, "test-stack"))).toThrow(
    /checkout|C:/i,
  );
  vi.stubEnv("MELLODIFAI_ROOT", "C:/unsafe-runtime");
  expect(() => stackDir("prod")).toThrow(/runtime|C:/i);
});

it("rejects a secrets junction into the checkout", () => {
  symlinkSync(
    repo,
    join(root, "secrets"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => rendered("prod")).toThrow(/checkout|C:/i);
});

it("removes inherited session and JWT overrides outside prod and preserves unrelated config", () => {
  const input =
    base.replace("[auth]", '[auth]\njwt_secret = "discard-this-test-value"') +
    '\n[auth.sessions]\ntimebox = "1h"\n';
  const t = rendered("dev", input);
  expect(t.auth.jwt_secret).toBeUndefined();
  expect(t.auth.sessions).toEqual({});
  expect(parse(renderConfig(base, "dev", dir)).storage).toEqual(
    parse(base).storage,
  );
  expect(renderConfig(input, "prod", dir)).not.toContain(
    "discard-this-test-value",
  );
});
