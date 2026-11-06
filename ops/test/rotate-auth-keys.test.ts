import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { type Runner, recordingRunner } from "../lib/run.js";
import { authServiceCommand } from "../lib/services.js";
import { rotateAuthKeys } from "../rotate-auth-keys.js";

let root = "";
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});
function fixture() {
  const base = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "task42-keys-"));
  vi.stubEnv("MELLODIFAI_ROOT", root);
}

it("provisions e2e JWKS, cookie keys, role URL and issuer off C and rotates with prior verification material", async () => {
  fixture();
  const result = await rotateAuthKeys("e2e");
  const old = JSON.parse(readFileSync(result.keyFile, "utf8"));
  const oldEnv = parseEnv(readFileSync(result.envFile, "utf8"));
  expect(old.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
  expect(Boolean(old.keys[0].d)).toBe(true);
  const key = createPrivateKey({ key: old.keys[0], format: "jwk" });
  const message = Buffer.from("rotation verification");
  expect(
    verify(
      "sha256",
      message,
      createPublicKey(key),
      sign("sha256", message, key),
    ),
  ).toBe(true);
  expect(oldEnv.MDF_AUTH_ISSUER).toBe("http://127.0.0.1:3212/oauth");
  expect(oldEnv.HOST).toBe("127.0.0.1");
  expect(oldEnv.PORT).toBe("3211");
  expect(new URL(oldEnv.MDF_AUTH_DATABASE_URL as string).username).toBe(
    "mdf_auth",
  );
  expect(new URL(oldEnv.MDF_AUTH_DATABASE_URL as string).port).toBe("45622");
  expect(oldEnv.MDF_AUTH_JWKS_PATH).toBe(result.keyFile);
  const oldCookies = JSON.parse(oldEnv.MDF_AUTH_COOKIE_KEYS as string);
  expect(Buffer.from(oldCookies[0], "base64url").length).toBe(32);
  await rotateAuthKeys("e2e");
  const next = JSON.parse(readFileSync(result.keyFile, "utf8"));
  const nextCookies = JSON.parse(
    parseEnv(readFileSync(result.envFile, "utf8"))
      .MDF_AUTH_COOKIE_KEYS as string,
  );
  expect(next.keys[0].kid === old.keys[0].kid).toBe(false);
  expect(next.keys[1].kid === old.keys[0].kid).toBe(true);
  expect(nextCookies[0] === oldCookies[0]).toBe(false);
  expect(nextCookies[1] === oldCookies[0]).toBe(true);
});

it("production provisioning stops before writes when the mdf-auth owner action is pending", async () => {
  fixture();
  const runner = recordingRunner([{ code: 1, stdout: "", stderr: "" }]);
  await expect(rotateAuthKeys("prod", runner)).rejects.toThrow("mdf-auth");
  expect(existsSync(join(root, "secrets/auth/jwks.json"))).toBe(false);
});

it("grants production files to mdf-auth and restores keys and env when restart fails", async () => {
  fixture();
  mkdirSync(join(root, "secrets/supabase"), { recursive: true });
  writeFileSync(
    join(root, "secrets/supabase/db-passwords.json"),
    JSON.stringify({ mdf_auth: "test-only-auth", mdf_web: "test-only-web" }),
  );
  const provision = recordingRunner();
  const files = await rotateAuthKeys("prod", provision);
  expect(
    provision.calls.filter(
      (call) => call.cmd === "icacls" && call.args.includes("mdf-auth:R"),
    ),
  ).toHaveLength(2);
  const before = [
    readFileSync(files.keyFile, "utf8"),
    readFileSync(files.envFile, "utf8"),
  ];
  let starts = 0;
  const actions: string[] = [];
  const runner: Runner = async (_cmd, args, options) => {
    if (args.includes("__stop")) actions.push("stop");
    if (args.includes("__start")) {
      actions.push("start");
      starts++;
    }
    if (args.includes("__stop") || args.includes("__start")) {
      expect(options?.env?.TEMP).toBe(join(root, "tmp"));
      expect(options?.env?.npm_config_store_dir).toBe(join(root, "cache/pnpm"));
    }
    return {
      code: args.includes("__start") && starts === 1 ? 1 : 0,
      stdout: "",
      stderr: "",
    };
  };
  await expect(rotateAuthKeys("prod", runner)).rejects.toThrow(
    "previous material restored",
  );
  expect(actions).toEqual(["stop", "start", "stop", "start"]);
  expect(readFileSync(files.keyFile, "utf8") === before[0]).toBe(true);
  expect(readFileSync(files.envFile, "utf8") === before[1]).toBe(true);
});

it("auth service starts Node directly with its canonical private env and TypeScript entry", () => {
  fixture();
  const command = authServiceCommand(root);
  expect(command.cmd).toBe(process.execPath);
  expect(command.cwd).toBe(join(root, "deploy/apps/auth"));
  expect(command.args).toEqual([
    `--env-file=${join(command.cwd, ".env.local")}`,
    "--import",
    "tsx",
    "src/main.ts",
  ]);
});
