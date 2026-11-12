import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { findKeyMaterial } from "../check-no-keys.js";
import { composeEnvironment } from "../lib/compose.js";
import { ENV_TABLE, runtimePath, stackDir } from "../lib/envs.js";
import { writePrivate } from "../lib/private-file.js";
import { checked } from "../lib/recovery.js";
import { type Runner, realRunner } from "../lib/run.js";
import { loadStackSecrets } from "../lib/stack-secrets.js";
import { rotateSupabaseKeys } from "../rotate-supabase-keys.js";
import { planStackCommand, runStackCommand } from "../stack.js";

const demo = "super-secret-jwt-token-with-at-least-32-characters-long";
function demoServiceToken() {
  const encode = (data: object) =>
    Buffer.from(JSON.stringify(data)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role: "service_role", iss: "supabase", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac("sha256", demo).update(body).digest("base64url")}`;
}

it("a service_role JWT signed with the public demo secret is refused by the gateway after rotation", async () => {
  const base = runtimePath(process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "task34-gateway-"));
  const originalRoot = process.env.MELLODIFAI_ROOT;
  const original = ENV_TABLE.prod;
  const project = `mellodifai_task34_${randomUUID().slice(0, 8)}`;
  process.env.MELLODIFAI_ROOT = root;
  // A throwaway e2e configuration with production hardening, never the live project/ports.
  ENV_TABLE.prod = {
    ...ENV_TABLE.e2e,
    ...original,
    projectId: project,
    ports: {
      api: 57621,
      db: 57622,
      studio: null,
      inbucket: null,
      analytics: null,
    },
    listeners: { shadow: 57620, inspector: 57628, pooler: 57629 },
    fakeStack: true,
    signingKeysPath: join(root, "secrets/supabase/signing_keys.json"),
  };
  const dir = stackDir("prod");
  const request = async (apikey: string, bearer: string) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await fetch(
          "http://127.0.0.1:57621/auth/v1/admin/users?page=1&per_page=1",
          {
            headers: { apikey, Authorization: `Bearer ${bearer}` },
            signal: AbortSignal.timeout(10000),
          },
        );
        await response.body?.cancel();
        if ([200, 401, 403].includes(response.status)) return response.status;
      } catch {
        /* Wait for Kong after restart. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Throwaway gateway did not become ready");
  };
  // Only application lifecycle/build is faked; key generation and Docker restart are real.
  const runner: Runner = async (cmd, args, opts) => {
    if (
      args.includes("__stop") ||
      args.includes("__start") ||
      args.includes("pnpm --filter @mellodifai/web build")
    )
      return { code: 0, stdout: "", stderr: "" };
    return realRunner(cmd, args, opts);
  };
  let privateEnv: Record<string, string> = {};
  try {
    await runStackCommand("render", "prod");
    const secrets = await loadStackSecrets("prod", true);
    secrets.jwt = demo;
    await writePrivate(
      join(root, "secrets/supabase/db-passwords.json"),
      JSON.stringify({ postgres: secrets.postgres }),
    );
    await writePrivate(
      join(root, "secrets/supabase/stack-secrets.json"),
      JSON.stringify(secrets),
    );
    await writePrivate(
      join(root, "deploy/apps/web/.env.local"),
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${secrets.anon}\n`,
    );
    await writePrivate(
      join(root, "deploy/apps/worker/.env.local"),
      `SUPABASE_SERVICE_ROLE_KEY=${secrets.service}\n`,
    );
    privateEnv = composeEnvironment("prod", secrets);
    for (const [cmd, ...args] of planStackCommand("start", "prod", {})) {
      if (!cmd) throw new Error("Missing stack command");
      await checked(realRunner, cmd, args, { env: privateEnv });
    }
    const token = demoServiceToken();
    expect(await request(secrets.service, secrets.service)).toBe(200);
    await rotateSupabaseKeys(runner);
    const rotated = await loadStackSecrets("prod");
    expect(
      rotated.jwt !== secrets.jwt && rotated.service !== secrets.service,
    ).toBe(true);
    expect(await request(rotated.service, rotated.service)).toBe(200);
    expect([401, 403]).toContain(await request(rotated.service, token));
    expect([401, 403]).toContain(
      await request(secrets.service, secrets.service),
    );
    expect(await findKeyMaterial([join(root, "stacks")])).toEqual([]);
    expect(readFileSync(join(dir, "supabase/config.toml"), "utf8")).toContain(
      "env(MDF_SUPABASE_JWT_SECRET)",
    );
  } finally {
    try {
      await checked(
        realRunner,
        "docker",
        [
          "compose",
          "-p",
          project,
          "-f",
          join(dir, "compose.json"),
          "down",
          "-v",
          "--remove-orphans",
        ],
        { env: privateEnv },
      );
      rmSync(root, { recursive: true, force: true });
    } finally {
      ENV_TABLE.prod = original;
      if (originalRoot === undefined) delete process.env.MELLODIFAI_ROOT;
      else process.env.MELLODIFAI_ROOT = originalRoot;
    }
  }
}, 300000);
