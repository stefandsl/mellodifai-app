import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderCompose } from "../lib/compose.js";
import { ENV_TABLE, stackDir } from "../lib/envs.js";
import { renderConfig } from "../lib/render.js";
import { loadStackSecrets } from "../lib/stack-secrets.js";

const base = readFileSync(
  fileURLToPath(new URL("../../supabase/config.toml", import.meta.url)),
  "utf8",
);
let root: string;
beforeEach(() => {
  mkdirSync("E:/mellodifai/tmp", { recursive: true });
  root = mkdtempSync("E:/mellodifai/tmp/compose-test-");
  vi.stubEnv("MELLODIFAI_ROOT", root);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
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
  const path = join(stackDir("e2e"), "supabase/templates/magic.html");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "<p>{{ .ConfirmationURL }}</p>");
  const toml = renderConfig(
    `${base}\n[auth.email.template.magic_link]\ncontent_path = "./supabase/templates/magic.html"\n`,
    "e2e",
    stackDir("e2e"),
  );
  const output = renderCompose("e2e", toml);
  expect(output.services.templates?.ports).toBeUndefined();
  expect(
    output.services.auth?.environment?.GOTRUE_MAILER_TEMPLATES_MAGIC_LINK,
  ).toBe("http://templates:8080/magic_link.html");
});
