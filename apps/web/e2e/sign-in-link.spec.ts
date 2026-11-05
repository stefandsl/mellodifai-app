import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { runtimePath } from "../../../ops/lib/envs";
import { writePrivate } from "../../../ops/lib/private-file";
import { localSupabaseUrl } from "./local-env";
import { E2E_ADMIN_EMAIL } from "./support";

// This test handles a sign-in credential; never retain it in a browser trace.
test.use({ trace: "off" });

test("sign-in-link prints a link that verifies on the target stack", async ({
  page,
  baseURL,
}) => {
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const require = createRequire(join(repo, "package.json"));
  const parent = runtimePath(
    join(
      process.env.RUNNER_TEMP ?? process.env.MELLODIFAI_ROOT ?? "E:/mellodifai",
      "tmp",
    ),
  );
  mkdirSync(parent, { recursive: true });
  const copy = mkdtempSync(join(parent, "task-9-cli-"));
  let link: string;
  try {
    cpSync(join(repo, "ops"), join(copy, "ops"), {
      recursive: true,
      filter: (path) =>
        !["node_modules", "dist", "test"].includes(basename(path)),
    });
    symlinkSync(
      join(repo, "node_modules"),
      join(copy, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    symlinkSync(
      join(repo, "ops/node_modules"),
      join(copy, "ops/node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const config = join(copy, "config/worker.env");
    await writePrivate(
      config,
      `SUPABASE_URL=${localSupabaseUrl()}\nSUPABASE_SERVICE_ROLE_KEY=${process.env.SUPABASE_SERVICE_ROLE_KEY}\n`,
    );
    const env: NodeJS.ProcessEnv = { ...process.env, MELLODIFAI_ROOT: copy };
    delete env.FORCE_COLOR;
    const result = spawnSync(
      process.execPath,
      [
        require.resolve("tsx/cli"),
        join(copy, "ops/sign-in-link.ts"),
        E2E_ADMIN_EMAIL,
        baseURL ?? "",
      ],
      { encoding: "utf8", windowsHide: true, env },
    );
    expect(result.status).toBe(0);
    expect(result.stderr.length).toBe(0);
    link = result.stdout.trim();
    expect(result.stdout.trim().split(/\r?\n/).length).toBe(1);
    expect(new URL(link).origin === baseURL).toBe(true);
  } finally {
    rmSync(runtimePath(copy), { recursive: true, force: true });
  }
  await page.goto(link);
  await expect(page).toHaveURL(/\/create$/);
  await page.goto("/library");
  await expect(page).toHaveURL(/\/library$/);
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?message=invalid-link$/);
});
