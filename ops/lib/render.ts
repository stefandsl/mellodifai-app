import {
  cpSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify, type TomlTable } from "smol-toml";
import {
  ENV_TABLE,
  IMAGE_PINS,
  redirectUrls,
  runtimePath,
  type StackEnv,
} from "./envs.js";

function table(parent: TomlTable, key: string): TomlTable {
  const value = parent[key];
  if (value === undefined) {
    const child: TomlTable = {};
    parent[key] = child;
    return child;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    throw new Error(`Expected TOML table: ${key}`);
  }
  return value as TomlTable;
}

/** Pure TOML render. Task 6 uses this contract to configure the compose fallback. */
export function renderConfig(
  baseToml: string,
  env: StackEnv,
  stackDirectory: string,
): string {
  runtimePath(stackDirectory);
  const values = ENV_TABLE[env];
  const config = parse(baseToml);
  config.project_id = values.projectId;
  const api = table(config, "api");
  api.port = values.ports.api;
  const schemas = api.schemas ?? [];
  if (
    !Array.isArray(schemas) ||
    schemas.some((schema) => typeof schema !== "string")
  )
    throw new Error("api.schemas must be a string array");
  api.schemas = [...new Set([...schemas, "ops"])];
  const db = table(config, "db");
  db.port = values.ports.db;
  db.shadow_port = values.listeners.shadow;
  Object.assign(table(db, "pooler"), {
    enabled: false,
    port: values.listeners.pooler,
  });
  table(db, "seed").sql_paths = ["./repo/seed.sql"];
  table(config, "edge_runtime").inspector_port = values.listeners.inspector;

  // CLI 3.0.0 rejects the design's historical inbucket spelling.
  delete config.inbucket;
  for (const [name, port] of [
    ["studio", values.ports.studio],
    ["local_smtp", values.ports.inbucket],
    ["analytics", values.ports.analytics],
  ] as const) {
    const service = table(config, name);
    service.enabled = port !== null;
    if (port === null) delete service.port;
    else service.port = port;
  }
  const mail = table(config, "local_smtp");
  delete mail.smtp_port;
  delete mail.pop3_port;

  const auth = table(config, "auth");
  auth.site_url = values.siteUrl;
  auth.additional_redirect_urls = redirectUrls(env);
  auth.enable_signup = false;
  auth.signing_keys_path = values.signingKeysPath.replaceAll("\\", "/");
  if (values.jwtSecretFromEnv) auth.jwt_secret = "env(MDF_SUPABASE_JWT_SECRET)";
  else delete auth.jwt_secret;
  table(auth, "rate_limit").email_sent = values.emailSentPerHour;
  auth.sessions = {
    ...(values.sessions.timebox ? { timebox: values.sessions.timebox } : {}),
    ...(values.sessions.inactivityTimeout
      ? { inactivity_timeout: values.sessions.inactivityTimeout }
      : {}),
  };
  // Never inherit an external SMTP sender into a fake/test environment. Owner
  // SMTP provisioning is deliberately separate; this renderer invents no credentials.
  if (values.smtp === "catcher") delete table(auth, "email").smtp;
  table(table(table(auth, "email"), "template"), "magic_link").content_path =
    "./compose/templates/magic_link.html";
  return stringify(config);
}

const defaultRepo = fileURLToPath(new URL("../../", import.meta.url));
const versionFiles = [
  "postgres",
  "storage",
  "rest",
  "gotrue",
  "realtime",
  "pgmeta",
  "studio",
  "edge-runtime",
  "logflare",
] as const;

/** Prepare external links and CLI pins; never generate keys or start a service.
 * The repo directory link lets seed.sql be referenced across Windows drives
 * without a privileged file symlink.
 */
export function prepareStackDir(
  stackDirectory: string,
  repoDirectory = defaultRepo,
): void {
  const destination = runtimePath(
    join(runtimePath(stackDirectory), "supabase"),
  );
  const source = resolve(repoDirectory, "supabase");
  const links = [
    ["migrations", join(source, "migrations")],
    ["templates", join(source, "templates")],
    ["repo", source],
  ] as const;
  const pending: [string, string][] = [];
  for (const [name, target] of links) {
    const path = join(destination, name);
    try {
      const stat = lstatSync(path);
      if (!stat.isSymbolicLink() || resolve(readlinkSync(path)) !== target)
        throw new Error(`Refusing to replace existing stack source: ${name}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      pending.push([path, target]);
    }
  }
  mkdirSync(destination, { recursive: true });
  for (const [path, target] of pending)
    symlinkSync(
      target,
      path,
      process.platform === "win32" ? "junction" : "dir",
    );
  // CLI 3 rejects content_path when a junction resolves outside the stack root.
  const templates = runtimePath(join(stackDirectory, "compose/templates"));
  mkdirSync(templates, { recursive: true });
  cpSync(
    join(source, "templates/magic_link.html"),
    join(templates, "magic_link.html"),
  );
  const temp = join(destination, ".temp");
  runtimePath(temp);
  mkdirSync(temp, { recursive: true });
  for (const service of versionFiles) {
    const path = join(temp, `${service}-version`);
    runtimePath(path);
    writeFileSync(path, IMAGE_PINS[service], "utf8");
  }
}
