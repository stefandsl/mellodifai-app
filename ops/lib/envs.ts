import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeRoot } from "./runtime.js";

export type StackEnv = "dev" | "e2e" | "ci" | "prod";
export interface StackValues {
  projectId: string;
  siteUrl: string;
  redirectUrls: string[];
  issuer: string | null;
  ports: {
    api: number;
    db: number;
    studio: number | null;
    inbucket: number | null;
    analytics: number | null;
  };
  listeners: { shadow: number; inspector: number; pooler: number };
  smtp: "catcher" | "owner";
  signingKeysPath: string;
  jwtSecretFromEnv: boolean;
  sessions: { timebox?: string; inactivityTimeout?: string };
  fakeStack: boolean;
  emailSentPerHour: number;
}

const checkout = fileURLToPath(new URL("../../", import.meta.url));

/** Validate before creating runtime files, including through existing junctions. */
export function runtimePath(path: string): string {
  if (!isAbsolute(path) || /^[cC]:[/\\]/.test(path)) {
    throw new Error("Runtime paths must be absolute and outside C:");
  }
  const target = resolve(path);
  const inside = (base: string, child: string) => {
    const rel = relative(base, child);
    return (
      rel === "" ||
      (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
    );
  };
  let ancestor = target;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor)
    ancestor = dirname(ancestor);
  const canonical = existsSync(ancestor)
    ? resolve(realpathSync(ancestor), relative(ancestor, target))
    : target;
  if (
    /^[cC]:[/\\]/.test(canonical) ||
    inside(checkout, target) ||
    inside(realpathSync(checkout), canonical)
  ) {
    throw new Error("Runtime paths must stay outside C: and the checkout");
  }
  return target;
}

function runnerTemp(): string {
  if (!process.env.RUNNER_TEMP) throw new Error("CI requires RUNNER_TEMP");
  return runtimePath(process.env.RUNNER_TEMP);
}

export function stackDir(env: StackEnv): string {
  return runtimePath(
    env === "ci"
      ? join(runnerTemp(), "stack")
      : join(runtimePath(runtimeRoot()), "stacks", env),
  );
}

function signingKey(env: StackEnv): string {
  if (env === "ci") return runtimePath(join(runnerTemp(), "signing_keys.json"));
  // Preflight ruling 6: dev/e2e keys must also be outside the scanned stacks tree.
  return runtimePath(
    join(
      runtimePath(runtimeRoot()),
      "secrets/supabase",
      env === "prod" ? "" : env,
      "signing_keys.json",
    ),
  );
}

/** Design 5.3, with the accepted preflight path and listener corrections. */
export const ENV_TABLE: Record<StackEnv, StackValues> = {
  dev: {
    projectId: "mellodifai_dev",
    siteUrl: "http://127.0.0.1:3001",
    redirectUrls: ["http://127.0.0.1:3001/**", "http://localhost:3001/**"],
    issuer: null,
    ports: {
      api: 55321,
      db: 55322,
      studio: 55323,
      inbucket: 55324,
      analytics: 55327,
    },
    listeners: { shadow: 55320, inspector: 55328, pooler: 55329 },
    smtp: "catcher",
    get signingKeysPath() {
      return signingKey("dev");
    },
    jwtSecretFromEnv: false,
    sessions: {},
    fakeStack: false,
    emailSentPerHour: 2,
  },
  e2e: {
    projectId: "mellodifai_e2e",
    siteUrl: "http://127.0.0.1:3210",
    redirectUrls: ["http://127.0.0.1:3210/**", "http://127.0.0.1:3212/**"],
    issuer: "http://127.0.0.1:3212/oauth",
    ports: {
      api: 45621,
      db: 45622,
      studio: 45623,
      inbucket: 45624,
      analytics: 45627,
    },
    listeners: { shadow: 45620, inspector: 45628, pooler: 45629 },
    smtp: "catcher",
    get signingKeysPath() {
      return signingKey("e2e");
    },
    jwtSecretFromEnv: false,
    sessions: {},
    fakeStack: true,
    emailSentPerHour: 2,
  },
  ci: {
    projectId: "mellodifai_ci",
    siteUrl: "http://127.0.0.1:3210",
    redirectUrls: ["http://127.0.0.1:3210/**", "http://127.0.0.1:3212/**"],
    issuer: "http://127.0.0.1:3212/oauth",
    ports: {
      api: 54321,
      db: 54322,
      studio: 54323,
      inbucket: 54324,
      analytics: 54327,
    },
    listeners: { shadow: 54320, inspector: 54328, pooler: 54329 },
    smtp: "catcher",
    get signingKeysPath() {
      return signingKey("ci");
    },
    jwtSecretFromEnv: false,
    sessions: {},
    fakeStack: true,
    emailSentPerHour: 2,
  },
  prod: {
    projectId: "mellodifai",
    siteUrl: "https://app.mellodifai.com",
    redirectUrls: [
      "https://app.mellodifai.com/**",
      "http://127.0.0.1:3000/**",
      "http://localhost:3000/**",
    ],
    issuer: "https://app.mellodifai.com/oauth",
    ports: {
      api: 54321,
      db: 54322,
      studio: null,
      inbucket: null,
      analytics: null,
    },
    listeners: { shadow: 54320, inspector: 54328, pooler: 54329 },
    smtp: "owner",
    get signingKeysPath() {
      return signingKey("prod");
    },
    jwtSecretFromEnv: true,
    sessions: { timebox: "168h", inactivityTimeout: "24h" },
    fakeStack: false,
    emailSentPerHour: 30,
  },
};

/** Accepted image ruling. Compose consumers must pin all twelve images. */
export const IMAGE_PINS = {
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
} as const;
export const SUPABASE_CLI_VERSION = "3.0.0";
export const COMPOSE_SOURCE_REVISION =
  "3dd097c78804b672e5f2c1fb954ede0bbf727620";
