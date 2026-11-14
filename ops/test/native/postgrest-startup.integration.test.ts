import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { nativeTools } from "../../lib/native/build.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { nativePlan } from "../../lib/native/plan.js";
import { renderConfig } from "../../lib/render.js";
import { runStack } from "../../stack.js";
import { assertNativeTestRoot } from "./integration-env.js";

const enabled = process.env.MDF_NATIVE_INTEGRATION === "1";

it.skipIf(!enabled)(
  "PostgREST survives concurrent libpq initialization with the operator's UTF-8 locale",
  async () => {
    assertNativeTestRoot();
    await runStack("stop", "e2e", { runtime: "native" });
    vi.stubEnv("LANG", "C.UTF-8");
    const layout = nativeLayout("e2e");
    const tools = nativeTools();
    const value = "synthetic-credential-".repeat(3);
    const spec = nativePlan({
      env: "e2e",
      hopSecret: value,
      layout,
      tools,
      toml: renderConfig(
        readFileSync(
          new URL("../../../supabase/config.toml", import.meta.url),
          "utf8",
        ),
        "e2e",
        layout.root,
      ),
      secrets: {
        postgres: value,
        jwt: value,
        realtime: value,
        crypto: value,
        dashboard: value,
        analytics: value,
        anon: value,
        service: value,
      },
      logins: {
        authenticator: value,
        supabase_auth_admin: value,
        supabase_storage_admin: value,
      },
      smtp: { MDF_SMTP_PASS: "" },
      tsx: { node: process.execPath, cli: "unused" },
      opsDir: resolve("."),
    }).find((s) => s.id === "rest");
    if (!spec) throw new Error("Missing PostgREST plan");
    // Refused connections exercise libpq's gettext path without any real DB data.
    spec.env.PGRST_DB_URI =
      "postgres://fixture@127.0.0.1:45622/postgres?connect_timeout=1";
    spec.env.PGRST_SERVER_PORT = "45628";
    const directory = join(
      process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp",
      `postgrest-regression-${Date.now()}`,
    );
    mkdirSync(directory, { recursive: true });
    const failures: { iteration: number; code: number | null }[] = [];
    try {
      for (let iteration = 1; iteration <= 100; iteration++) {
        const fd = openSync(join(directory, `${iteration}.log`), "w");
        const child = spawn(spec.command, spec.args, {
          env: spec.env as NodeJS.ProcessEnv,
          cwd: spec.cwd,
          detached: true,
          windowsHide: true,
          stdio: ["ignore", fd, fd],
        });
        closeSync(fd);
        const exited = new Promise<number | null>((done, fail) => {
          child.once("exit", done);
          child.once("error", fail);
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([
            exited.then((code) => ({ code })),
            new Promise<null>((done) => {
              timer = setTimeout(() => done(null), 500);
            }),
          ]);
          if (outcome) failures.push({ iteration, code: outcome.code });
        } finally {
          clearTimeout(timer);
          if (child.exitCode === null && child.signalCode === null)
            child.kill();
          await exited;
        }
      }
      writeFileSync(
        join(directory, "result.json"),
        JSON.stringify({ iterations: 100, failures }, null, 2),
      );
      expect(failures).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  },
  120_000,
);
