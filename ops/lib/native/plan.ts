import { delimiter, dirname, join } from "node:path";
import { composeEnvironment, renderCompose } from "../compose.js";
import { ENV_TABLE, redirectUrls, type StackEnv } from "../envs.js";
import type { StackSecrets } from "../stack-secrets.js";
import type { NativeTools } from "./build.js";
import type { GatewayConfig } from "./gateway.js";
import { loopback, type NativeLayout } from "./layout.js";

export type DbLogins = Record<string, string>;

export interface ProcessSpec {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  dependsOn: string[];
  /** URL that answers 200 once the service can take requests. */
  ready: string;
  /** Spawn with an IPC channel; closing it asks the process to stop. */
  ipc?: boolean;
}

export interface PlanInput {
  env: StackEnv;
  layout: NativeLayout;
  tools: NativeTools;
  /** Rendered supabase/config.toml of this stack. */
  toml: string;
  secrets: StackSecrets;
  logins: DbLogins;
  /** MDF_SMTP_PASS for production, empty elsewhere. */
  smtp: Record<string, string>;
  /** Node and tsx entry used to run TypeScript from ops/. */
  tsx: { node: string; cli: string };
  opsDir: string;
}

/** Resolve the Compose interpolation forms the pinned baseline and the SMTP
 * renderer use. An unknown variable is an error, never an empty string.
 */
export function interpolate(
  value: string,
  variables: Record<string, string>,
): string {
  return value.replace(
    /\$\{([A-Z_][A-Z0-9_]*)(?::([-+])([^}]*))?\}/g,
    (_match, name: string, operator?: string, operand?: string) => {
      const found = variables[name];
      if (operator === "+") return found ? (operand ?? "") : "";
      if (operator === "-") return found ? found : (operand ?? "");
      if (found === undefined)
        throw new Error(`Compose variable ${name} is not defined`);
      return found;
    },
  );
}

/** The exact environment Auth, PostgREST and Storage receive from the Compose
 * renderer, with every reference resolved. Native settings start from this so
 * both runtimes hand the services one contract.
 */
export function composeContract(
  env: StackEnv,
  toml: string,
  secrets: StackSecrets,
  smtp: Record<string, string>,
): Record<"auth" | "rest" | "storage", Record<string, string>> {
  const services = renderCompose(env, toml).services;
  const variables = { ...composeEnvironment(env, secrets), ...smtp };
  const resolve = (name: string) =>
    Object.fromEntries(
      Object.entries(services[name]?.environment ?? {}).map(([key, value]) => [
        key,
        interpolate(String(value), variables),
      ]),
    );
  return {
    auth: resolve("auth"),
    rest: resolve("rest"),
    storage: resolve("storage"),
  };
}

export function serviceDatabaseUrl(
  role: string,
  logins: DbLogins,
  port: number,
): string {
  const password = logins[role];
  if (!password) throw new Error(`No stored login for database role ${role}`);
  return `postgres://${role}:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`;
}

const INHERITED = [
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "USERNAME",
  "USERPROFILE",
  "HOME",
  "LANG",
];

/** Services get a small, explicit environment: nothing from the operator's
 * shell (which may hold unrelated keys) and temp files inside the stack.
 */
export function baseEnvironment(
  layout: NativeLayout,
  parent: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    PATH: parent.PATH ?? parent.Path ?? "",
    TEMP: layout.tmp,
    TMP: layout.tmp,
    TMPDIR: layout.tmp,
    APPDATA: join(layout.tmp, "appdata"),
    LOCALAPPDATA: join(layout.tmp, "localappdata"),
  };
}

export function gatewayConfig(
  env: StackEnv,
  layout: NativeLayout,
  secrets: StackSecrets,
): GatewayConfig {
  const origins = [ENV_TABLE[env].siteUrl, ...redirectUrls(env)].map(
    (url) => new URL(url.replace(/\/\*\*$/, "")).origin,
  );
  return {
    host: "127.0.0.1",
    port: layout.ports.api,
    upstreams: {
      auth: loopback(layout.ports.auth),
      rest: loopback(layout.ports.rest),
      storage: loopback(layout.ports.storage),
    },
    keys: { anon: secrets.anon, service: secrets.service },
    appOrigins: [...new Set(origins)],
  };
}

export const GATEWAY_CONFIG_FILE = "gateway.json";

/** Pure description of every long-running service process. Secrets appear
 * only in environment values, never in a command line.
 */
export function nativePlan(input: PlanInput): ProcessSpec[] {
  const { env, layout, tools, logins } = input;
  const { ports } = layout;
  const contract = composeContract(env, input.toml, input.secrets, input.smtp);
  const base = baseEnvironment(layout);
  const catcher = ports.mailHttp !== null && ports.mailSmtp !== null;

  const auth: Record<string, string> = {
    ...contract.auth,
    GOTRUE_API_HOST: "127.0.0.1",
    GOTRUE_API_PORT: String(ports.auth),
    GOTRUE_DB_DATABASE_URL: serviceDatabaseUrl(
      "supabase_auth_admin",
      logins,
      ports.db,
    ),
    ...(catcher
      ? {
          GOTRUE_SMTP_HOST: "127.0.0.1",
          GOTRUE_SMTP_PORT: String(ports.mailSmtp),
        }
      : {}),
  };
  for (const [key, value] of Object.entries(auth))
    if (key.startsWith("GOTRUE_MAILER_TEMPLATES_"))
      auth[key] = value.replace(
        /^http:\/\/templates:8080\//,
        `${loopback(ports.templates)}/`,
      );

  const specs: ProcessSpec[] = [
    {
      id: "auth",
      command: tools.auth,
      args: ["serve"],
      env: { ...base, ...auth },
      cwd: dirname(tools.auth),
      dependsOn: ["database", "templates", ...(catcher ? ["mailpit"] : [])],
      ready: `${loopback(ports.auth)}/health`,
    },
    {
      id: "rest",
      command: tools.postgrest,
      args: [],
      env: {
        ...base,
        // PostgREST loads libpq from the PostgreSQL binaries.
        PATH: `${tools.pgBin}${delimiter}${base.PATH}`,
        ...contract.rest,
        PGRST_DB_URI: serviceDatabaseUrl("authenticator", logins, ports.db),
        PGRST_SERVER_HOST: "127.0.0.1",
        PGRST_SERVER_PORT: String(ports.rest),
      },
      cwd: dirname(tools.postgrest),
      dependsOn: ["database"],
      ready: `${loopback(ports.rest)}/`,
    },
    {
      id: "storage",
      command: tools.node,
      args: ["dist/start/server.js"],
      env: {
        ...base,
        ...contract.storage,
        NODE_ENV: "production",
        DATABASE_URL: serviceDatabaseUrl(
          "supabase_storage_admin",
          logins,
          ports.db,
        ),
        POSTGREST_URL: loopback(ports.rest),
        FILE_STORAGE_BACKEND_PATH: layout.objects,
        SERVER_HOST: "127.0.0.1",
        SERVER_PORT: String(ports.storage),
      },
      cwd: tools.storageDir,
      dependsOn: ["database", "rest"],
      ready: `${loopback(ports.storage)}/status`,
    },
  ];
  if (catcher)
    specs.push({
      id: "mailpit",
      command: tools.mailpit,
      args: [],
      env: {
        ...base,
        MP_UI_BIND_ADDR: `127.0.0.1:${ports.mailHttp}`,
        MP_SMTP_BIND_ADDR: `127.0.0.1:${ports.mailSmtp}`,
        MP_DISABLE_VERSION_CHECK: "true",
      },
      cwd: dirname(tools.mailpit),
      dependsOn: [],
      ready: `${loopback(ports.mailHttp as number)}/readyz`,
    });
  specs.push({
    id: "gateway",
    command: input.tsx.node,
    args: [input.tsx.cli, join(input.opsDir, "native-gateway.ts")],
    env: {
      ...base,
      MDF_GATEWAY_CONFIG: join(layout.config, GATEWAY_CONFIG_FILE),
    },
    cwd: input.opsDir,
    dependsOn: ["auth", "rest", "storage"],
    ready: `${loopback(ports.api)}/health`,
    ipc: true,
  });
  return specs;
}

/** Environment for the one-shot migration commands of Auth and Storage. */
export function migrationEnvironments(specs: ProcessSpec[]) {
  const find = (id: string) => {
    const spec = specs.find((item) => item.id === id);
    if (!spec) throw new Error(`Missing native service: ${id}`);
    return spec;
  };
  return { auth: find("auth"), storage: find("storage") };
}
