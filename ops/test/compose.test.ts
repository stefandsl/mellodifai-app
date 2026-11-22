import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { composeEnvironment, renderCompose } from "../lib/compose.js";
import { ENV_TABLE, runtimePath, stackDir } from "../lib/envs.js";
import { renderConfig } from "../lib/render.js";
import { loadStackSecrets } from "../lib/stack-secrets.js";

const base = readFileSync(
  fileURLToPath(new URL("../../supabase/config.toml", import.meta.url)),
  "utf8",
);
const fixtureBase = runtimePath(
  process.env.RUNNER_TEMP ??
    join(process.env.MELLODIFAI_ROOT ?? "E:/mellodifai", "tmp"),
);
let root = "";
it("creates fixtures under the configured external temporary directory", () => {
  expect(dirname(root)).toBe(fixtureBase);
});
beforeEach(() => {
  root = "";
  const tmp = runtimePath(fixtureBase);
  mkdirSync(tmp, { recursive: true });
  root = mkdtempSync(join(tmp, "compose-test-"));
  vi.stubEnv("MELLODIFAI_ROOT", root);
  vi.stubEnv("RUNNER_TEMP", join(root, "runner"));
  for (const env of ["dev", "e2e", "ci", "prod"] as const) {
    const path = join(stackDir(env), "compose/templates");
    mkdirSync(path, { recursive: true });
    cpSync(
      fileURLToPath(
        new URL("../../supabase/templates/magic_link.html", import.meta.url),
      ),
      join(path, "magic_link.html"),
    );
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
});

it("signs API keys with the configured ES256 key and supplies verifier keys to every API consumer", async () => {
  const secrets = await loadStackSecrets("e2e", true);
  const header = JSON.parse(
    Buffer.from(secrets.service.split(".")[0] ?? "", "base64url").toString(),
  );
  expect(header.alg).toBe("ES256");
  const output = renderCompose(
    "e2e",
    renderConfig(base, "e2e", stackDir("e2e")),
  );
  for (const [service, variable] of [
    ["rest", "PGRST_JWT_SECRET"],
    ["storage", "JWT_JWKS"],
    ["realtime", "API_JWT_JWKS"],
  ] as const)
    expect(output.services[service]?.environment?.[variable]).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation
      "${PUBLIC_JWKS}",
    );
});

it("pins every enabled service and only publishes the environment's loopback ports", () => {
  const output = renderCompose(
    "e2e",
    renderConfig(base, "e2e", stackDir("e2e")),
  );
  for (const service of Object.values(output.services)) {
    expect(service.image).toMatch(/^public\.ecr\.aws\/supabase\/.+:[\w.-]+$/);
    for (const port of service.ports ?? [])
      expect(port).toMatch(/^127\.0\.0\.1:4562[12347]:/);
  }
  expect(output.services.rest?.environment?.PGRST_DB_SCHEMAS).toContain("ops");
  expect(output.services.auth?.environment?.GOTRUE_SMTP_MAX_FREQUENCY).toBe(
    "1s",
  );
  expect(JSON.stringify(output)).not.toContain("spikes");
});

it("allows the selected e2e browser callback in both stack configurations", async () => {
  vi.stubEnv("E2E_PORT", "3238");
  const toml = renderConfig(base, "e2e", stackDir("e2e"));
  const callback = "http://127.0.0.1:3238/**";
  expect(toml).toContain(callback);
  const secrets = await loadStackSecrets("e2e", true);
  expect(composeEnvironment("e2e", secrets).ADDITIONAL_REDIRECT_URLS).toContain(
    callback,
  );
  vi.stubEnv("E2E_PORT", "0");
  expect(() => renderConfig(base, "e2e", stackDir("e2e"))).toThrow(
    "Invalid E2E_PORT",
  );
});

it("production disables local tools and enforces session lifetimes", () => {
  const output = renderCompose(
    "prod",
    renderConfig(base, "prod", stackDir("prod")),
  );
  for (const name of ["studio", "analytics", "vector", "mailpit"])
    expect(output.services[name]).toBeUndefined();
  expect(output.services.auth?.environment?.GOTRUE_SESSIONS_TIMEBOX).toBe(
    "168h",
  );
  expect(
    output.services.auth?.environment?.GOTRUE_SESSIONS_INACTIVITY_TIMEOUT,
  ).toBe("24h");
});

it("only production auth receives SMTP secret references; dev/e2e/ci retain Mailpit", () => {
  for (const env of ["dev", "e2e", "ci", "prod"] as const) {
    const output = renderCompose(env, renderConfig(base, env, stackDir(env)));
    const auth = output.services.auth?.environment;
    if (env === "prod") {
      expect(auth?.GOTRUE_SMTP_PASS).toBe("$" + "{MDF_SMTP_PASS:-}");
      expect(auth?.GOTRUE_SMTP_HOST).toBe(
        "$" + "{MDF_SMTP_PASS:+smtp.resend.com}",
      );
      expect(auth?.GOTRUE_SMTP_PORT).toBe("465");
      for (const [name, service] of Object.entries(output.services)) {
        if (name !== "auth")
          expect(JSON.stringify(service)).not.toContain("MDF_SMTP");
      }
    } else {
      expect(JSON.stringify(output)).not.toContain("MDF_SMTP");
      expect(output.services.mailpit).toBeDefined();
      expect(auth?.GOTRUE_SMTP_HOST).toBe("$" + "{SMTP_HOST}");
    }
  }
});

it("bootstraps production signing material once outside stacks without activating production", async () => {
  await loadStackSecrets("prod", true);
  const path = ENV_TABLE.prod.signingKeysPath;
  const initial = readFileSync(path, "utf8");
  await loadStackSecrets("prod", true);
  expect(readFileSync(path, "utf8")).toBe(initial);
  expect(path).not.toContain("stacks");
  expect(JSON.parse(initial)[0]).toMatchObject({
    alg: "ES256",
    key_ops: ["sign", "verify"],
  });
  await expect(loadStackSecrets("prod")).rejects.toThrow(/Task 8/);
});

it("serves configured email templates on an internal-only endpoint", () => {
  const path = join(stackDir("e2e"), "compose/templates/magic_link.html");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "<p>{{ .ConfirmationURL }}</p>");
  const toml = renderConfig(base, "e2e", stackDir("e2e"));
  const output = renderCompose("e2e", toml);
  expect(output.services.templates?.ports).toBeUndefined();
  expect(output.services.templates?.entrypoint).toEqual([
    "/usr/local/bin/nginx",
    "-p",
    "/tmp/",
    "-e",
    "/dev/stderr",
    "-c",
    "/etc/nginx/templates.conf",
    "-g",
    "daemon off;",
  ]);
  expect(output.services.templates?.healthcheck).toMatchObject({
    test: [
      "CMD",
      "/bin/busybox",
      "wget",
      "-q",
      "-O",
      "/dev/null",
      "http://127.0.0.1:8080/magic_link.html",
    ],
  });
  expect(
    output.services.auth?.environment?.GOTRUE_MAILER_TEMPLATES_MAGIC_LINK,
  ).toBe("http://templates:8080/magic_link.html");
  expect(
    output.services.auth?.environment?.GOTRUE_MAILER_SUBJECTS_MAGIC_LINK,
  ).toBe("Il tuo codice di accesso a MellodifAI");
});

it("adopts existing production volumes without creating replacements and retains the mapping on render", () => {
  const dir = stackDir("prod");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "legacy-volumes.json"),
    JSON.stringify({
      db: "supabase_db_mellodifai",
      storage: "supabase_storage_mellodifai",
    }),
  );
  const output = renderCompose("prod", renderConfig(base, "prod", dir));
  expect(output.volumes).toMatchObject({
    legacy_db: { external: true, name: "supabase_db_mellodifai" },
    legacy_storage: { external: true, name: "supabase_storage_mellodifai" },
  });
  expect(output.services.db?.volumes).toContainEqual({
    type: "volume",
    source: "legacy_db",
    target: "/var/lib/postgresql/data",
  });
  expect(output.services.storage?.volumes).toContainEqual({
    type: "volume",
    source: "legacy_storage",
    target: "/var/lib/storage",
  });
  writeFileSync(
    join(dir, "legacy-volumes.json"),
    JSON.stringify({ db: "other", storage: "other" }),
  );
  expect(() => renderCompose("prod", renderConfig(base, "prod", dir))).toThrow(
    "Invalid cutover",
  );
});
