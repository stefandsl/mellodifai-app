import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
  ENV_TABLE,
  IMAGE_PINS,
  redirectUrls,
  type StackEnv,
  stackDir,
} from "./envs.js";
import type { StackSecrets } from "./stack-secrets.js";

interface Service {
  image: string;
  container_name?: string;
  restart?: string;
  environment?: Record<string, string | number | boolean>;
  depends_on?: Record<string, { condition: string }>;
  volumes?: (
    | string
    | { type: string; source: string; target: string; read_only?: boolean }
  )[];
  ports?: string[];
  entrypoint?: string | string[];
  command?: string[];
  healthcheck?: object;
  networks?: object;
}
interface Compose {
  services: Record<string, Service>;
  volumes?: object;
  name?: string;
}
const source = fileURLToPath(new URL("../compose/", import.meta.url));
const images: Record<string, string> = {
  db: `postgres:${IMAGE_PINS.postgres}`,
  auth: `gotrue:${IMAGE_PINS.gotrue}`,
  rest: `postgrest:${IMAGE_PINS.rest}`,
  storage: `storage-api:${IMAGE_PINS.storage}`,
  realtime: `realtime:${IMAGE_PINS.realtime}`,
  meta: `postgres-meta:${IMAGE_PINS.pgmeta}`,
  studio: `studio:${IMAGE_PINS.studio}`,
  functions: `edge-runtime:${IMAGE_PINS["edge-runtime"]}`,
  analytics: `logflare:${IMAGE_PINS.logflare}`,
  kong: `kong:${IMAGE_PINS.kong}`,
  vector: `vector:${IMAGE_PINS.vector}`,
  mailpit: `mailpit:${IMAGE_PINS.mailpit}`,
};

export function renderCompose(env: StackEnv, toml: string): Compose {
  const dir = stackDir(env);
  const values = ENV_TABLE[env];
  const config = parseToml(toml) as unknown as {
    api: { schemas: string[] };
    auth: {
      email?: {
        max_frequency?: string;
        otp_length?: number;
        otp_expiry?: number;
        enable_confirmations?: boolean;
        double_confirm_changes?: boolean;
        smtp?: {
          enabled?: boolean;
          host?: string;
          port?: number;
          user?: string;
          pass?: string;
          admin_email?: string;
          sender_name?: string;
        };
        template?: Record<string, { content_path: string }>;
      };
    };
  };
  const compose = parseYaml(
    readFileSync(join(source, "base.yml"), "utf8"),
  ) as Compose;
  delete compose.name;
  delete compose.services.imgproxy;
  delete compose.services.supavisor;
  // Vector's Docker logging endpoint failed the spike. Analytics remains local
  // and healthy without log ingestion; no Docker socket is exposed to services.
  delete compose.services.vector;
  if (values.ports.studio === null) delete compose.services.studio;
  if (values.ports.analytics === null) delete compose.services.analytics;
  for (const [name, service] of Object.entries(compose.services)) {
    service.image = `public.ecr.aws/supabase/${images[name]}`;
    delete service.container_name;
    delete service.ports;
    for (const dependency of Object.keys(service.depends_on ?? {}))
      if (!compose.services[dependency])
        delete service.depends_on?.[dependency];
    if (service.volumes)
      service.volumes = service.volumes.map((volume) => {
        if (typeof volume !== "string" || !volume.startsWith("./"))
          return volume;
        const [relative, target, mode] = volume.split(":");
        if (!relative || !target)
          throw new Error("Invalid volume in pinned baseline");
        return {
          type: "bind",
          source: join(dir, "compose", relative),
          target,
          read_only: mode?.includes("ro") ?? false,
        };
      });
  }
  const s = compose.services;
  const required = (name: string): Service => {
    const service = s[name];
    if (!service) throw new Error(`Missing compose service: ${name}`);
    return service;
  };
  const publish = (name: string, host: number | null, target: number) => {
    if (host !== null) required(name).ports = [`127.0.0.1:${host}:${target}`];
  };
  publish("kong", values.ports.api, 8000);
  publish("db", values.ports.db, 5432);
  publish("studio", values.ports.studio, 3000);
  publish("analytics", values.ports.analytics, 4000);
  required("kong").environment = {
    ...required("kong").environment,
    KONG_DNS_VALID_TTL: "1",
    KONG_DNS_STALE_TTL: "1",
  };
  required("realtime").environment = {
    ...required("realtime").environment,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation
    METRICS_JWT_SECRET: "${JWT_SECRET}",
  };
  required("realtime").networks = {
    default: { aliases: ["realtime-dev.supabase-realtime"] },
  };
  required("realtime").healthcheck = {
    test: ["CMD", "curl", "-fsS", "http://127.0.0.1:4000/healthcheck"],
    interval: "5s",
    timeout: "5s",
    retries: 10,
  };
  required("storage").environment = {
    ...required("storage").environment,
    ENABLE_IMAGE_TRANSFORMATION: "false",
  };
  delete required("storage").environment?.IMGPROXY_URL;
  required("rest").environment = {
    ...required("rest").environment,
    PGRST_DB_SCHEMAS: config.api.schemas.join(","),
  };
  const verifier = "$" + "{PUBLIC_JWKS}";
  const restEnvironment = required("rest").environment ?? {};
  restEnvironment.PGRST_JWT_SECRET = verifier;
  const storageEnvironment = required("storage").environment ?? {};
  storageEnvironment.JWT_JWKS = verifier;
  const realtimeEnvironment = required("realtime").environment ?? {};
  realtimeEnvironment.API_JWT_JWKS = verifier;
  const functionsEnvironment = required("functions").environment ?? {};
  functionsEnvironment.JWT_JWKS = verifier;
  required("auth").environment = {
    ...required("auth").environment,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation
    GOTRUE_JWT_KEYS: "${GOTRUE_JWT_KEYS}",
    GOTRUE_RATE_LIMIT_EMAIL_SENT: values.emailSentPerHour,
    ...(values.sessions.timebox
      ? { GOTRUE_SESSIONS_TIMEBOX: values.sessions.timebox }
      : {}),
    ...(values.sessions.inactivityTimeout
      ? {
          GOTRUE_SESSIONS_INACTIVITY_TIMEOUT: values.sessions.inactivityTimeout,
        }
      : {}),
  };
  const email = config.auth.email;
  const authEnvironment = required("auth").environment ?? {};
  authEnvironment.GOTRUE_SMTP_MAX_FREQUENCY = email?.max_frequency ?? "1m";
  authEnvironment.GOTRUE_MAILER_OTP_LENGTH = email?.otp_length ?? 6;
  authEnvironment.GOTRUE_MAILER_OTP_EXP = email?.otp_expiry ?? 3600;
  authEnvironment.GOTRUE_MAILER_AUTOCONFIRM = String(
    email?.enable_confirmations === false,
  );
  authEnvironment.GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED = String(
    email?.double_confirm_changes ?? true,
  );
  if (env === "prod" && email?.smtp?.enabled) {
    const smtp = email.smtp;
    for (const [field, name] of Object.entries({
      host: "HOST",
      port: "PORT",
      user: "USER",
      pass: "PASS",
      admin_email: "ADMIN_EMAIL",
      sender_name: "SENDER_NAME",
    })) {
      const value = smtp[field as keyof typeof smtp];
      if (value === undefined) continue;
      const reference = /^env\(([A-Z_][A-Z0-9_]*)\)$/.exec(String(value));
      if (field === "pass" && !reference)
        throw new Error("SMTP credentials must use an environment reference");
      authEnvironment[`GOTRUE_SMTP_${name}`] = reference
        ? "$" + `{${reference[1]}}`
        : String(value);
    }
  }
  if (values.ports.inbucket !== null) {
    s.mailpit = {
      image: `public.ecr.aws/supabase/${images.mailpit}`,
      restart: "unless-stopped",
      ports: [`127.0.0.1:${values.ports.inbucket}:8025`],
    };
  }
  // The linked repository template is served only on the Compose network.
  const templates = config.auth.email?.template ?? {};
  for (const [kind, template] of Object.entries(templates)) {
    const path = resolve(dir, template.content_path);
    if (!existsSync(path))
      throw new Error(`Missing configured email template: ${kind}`);
    mkdirSync(join(dir, "compose/templates"), { recursive: true });
    const staged = join(dir, "compose/templates", `${kind}.html`);
    if (resolve(path) !== resolve(staged)) cpSync(path, staged);
    const authEnvironment = required("auth").environment ?? {};
    authEnvironment[`GOTRUE_MAILER_TEMPLATES_${kind.toUpperCase()}`] =
      `http://templates:8080/${kind}.html`;
  }
  if (Object.keys(templates).length) {
    // The pinned Kong image includes nginx, but its BusyBox has no httpd applet.
    const nginxConfig = join(dir, "compose/template-nginx.conf");
    writeFileSync(
      nginxConfig,
      "pid /tmp/nginx.pid;\nerror_log /dev/stderr;\nevents {}\nhttp { access_log off; server { listen 8080; root /templates; } }\n",
    );
    s.templates = {
      image: `public.ecr.aws/supabase/${images.kong}`,
      restart: "unless-stopped",
      entrypoint: [
        "/usr/local/bin/nginx",
        "-p",
        "/tmp/",
        "-e",
        "/dev/stderr",
        "-c",
        "/etc/nginx/templates.conf",
        "-g",
        "daemon off;",
      ],
      healthcheck: {
        test: [
          "CMD",
          "/bin/busybox",
          "wget",
          "-q",
          "-O",
          "/dev/null",
          "http://127.0.0.1:8080/magic_link.html",
        ],
        interval: "5s",
        timeout: "5s",
        retries: 3,
      },
      volumes: [
        {
          type: "bind",
          source: nginxConfig,
          target: "/etc/nginx/templates.conf",
          read_only: true,
        },
        {
          type: "bind",
          source: join(dir, "compose/templates"),
          target: "/templates",
          read_only: true,
        },
      ],
    };
  }
  const legacyFile = join(dir, "legacy-volumes.json");
  if (env === "prod" && existsSync(legacyFile)) {
    const legacy = JSON.parse(readFileSync(legacyFile, "utf8"));
    if (
      legacy.db !== "supabase_db_mellodifai" ||
      legacy.storage !== "supabase_storage_mellodifai"
    )
      throw new Error("Invalid cutover volume mapping");
    compose.volumes = {
      ...compose.volumes,
      legacy_db: { external: true, name: legacy.db },
      legacy_storage: { external: true, name: legacy.storage },
    };
    for (const [name, target, volume] of [
      ["db", "/var/lib/postgresql/data", "legacy_db"],
      ["storage", "/var/lib/storage", "legacy_storage"],
    ] as const)
      required(name).volumes = (required(name).volumes ?? []).map((mount) =>
        typeof mount !== "string" && mount.target === target
          ? { type: "volume", source: volume, target }
          : mount,
      );
  }
  return compose;
}

export function prepareCompose(env: StackEnv, toml: string): void {
  const dir = stackDir(env);
  mkdirSync(join(dir, "compose"), { recursive: true });
  cpSync(join(source, "volumes"), join(dir, "compose/volumes"), {
    recursive: true,
  });
  const compose = renderCompose(env, toml);
  writeFileSync(join(dir, "compose.json"), JSON.stringify(compose, null, 2));
}

export function composeEnvironment(
  env: StackEnv,
  secrets: StackSecrets,
): Record<string, string> {
  const v = ENV_TABLE[env];
  const keys = JSON.parse(readFileSync(v.signingKeysPath, "utf8")) as Record<
    string,
    unknown
  >[];
  const publicKeys = keys.map((key) => {
    const { d: _private, ...publicKey } = key;
    return { ...publicKey, key_ops: ["verify"] };
  });
  return {
    POSTGRES_HOST: "db",
    POSTGRES_PORT: "5432",
    POSTGRES_DB: "postgres",
    POSTGRES_PASSWORD: secrets.postgres,
    JWT_SECRET: secrets.jwt,
    MDF_SUPABASE_JWT_SECRET: secrets.jwt,
    JWT_EXPIRY: "3600",
    ANON_KEY: secrets.anon,
    SERVICE_ROLE_KEY: secrets.service,
    GOTRUE_JWT_KEYS: readFileSync(v.signingKeysPath, "utf8"),
    PUBLIC_JWKS: JSON.stringify({ keys: publicKeys }),
    SECRET_KEY_BASE: secrets.realtime,
    PG_META_CRYPTO_KEY: secrets.crypto,
    LOGFLARE_PUBLIC_ACCESS_TOKEN: secrets.analytics,
    LOGFLARE_PRIVATE_ACCESS_TOKEN: secrets.analytics,
    DASHBOARD_USERNAME: "owner",
    DASHBOARD_PASSWORD: secrets.dashboard,
    API_EXTERNAL_URL: `http://127.0.0.1:${v.ports.api}`,
    SUPABASE_PUBLIC_URL: `http://127.0.0.1:${v.ports.api}`,
    SITE_URL: v.siteUrl,
    ADDITIONAL_REDIRECT_URLS: redirectUrls(env).join(","),
    DISABLE_SIGNUP: "true",
    ENABLE_EMAIL_SIGNUP: "true",
    ENABLE_ANONYMOUS_USERS: "false",
    ENABLE_EMAIL_AUTOCONFIRM: "false",
    ENABLE_PHONE_SIGNUP: "false",
    ENABLE_PHONE_AUTOCONFIRM: "false",
    SMTP_HOST: env === "prod" ? "" : "mailpit",
    SMTP_PORT: "1025",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_ADMIN_EMAIL: env === "prod" ? "" : "admin@example.test",
    SMTP_SENDER_NAME: "MellodifAI",
    MAILER_URLPATHS_INVITE: "/auth/v1/verify",
    MAILER_URLPATHS_CONFIRMATION: "/auth/v1/verify",
    MAILER_URLPATHS_RECOVERY: "/auth/v1/verify",
    MAILER_URLPATHS_EMAIL_CHANGE: "/auth/v1/verify",
    FUNCTIONS_VERIFY_JWT: "true",
    STUDIO_DEFAULT_ORGANIZATION: "MellodifAI",
    STUDIO_DEFAULT_PROJECT: v.projectId,
    OPENAI_API_KEY: "",
  };
}
