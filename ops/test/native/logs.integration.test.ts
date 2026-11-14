import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { expect, it } from "vitest";
import { nativeLayout } from "../../lib/native/layout.js";
import { runStack } from "../../stack.js";
import { assertNativeIntegrationEnvironment } from "./integration-env.js";

const enabled = process.env.MDF_NATIVE_INTEGRATION === "1";

it.skipIf(!enabled)(
  "keeps statements, row values and redirect query strings out of every native log",
  async () => {
    assertNativeIntegrationEnvironment();
    await runStack("start", "e2e", { runtime: "native" });
    const layout = nativeLayout("e2e");
    const gateway = process.env.SUPABASE_URL as string;
    const anon = process.env.SUPABASE_ANON_KEY as string;
    // Short, plain markers: no pattern-based redaction would recognise them,
    // so only the services' own logging settings keep them off the disk.
    const run = Date.now().toString(36);
    const markers = {
      cast: `syncast${run}`,
      row: `synrow${run}`,
      redirect: `synredir${run}`,
      token: `syntoken${run}`,
    };
    const sql = postgres(process.env.TEST_DB_URL as string, {
      max: 1,
      onnotice: () => {},
    });
    try {
      await expect(
        sql.unsafe(`select '${markers.cast}'::integer`),
      ).rejects.toThrow();
      await expect(
        sql.unsafe(
          `select 1 / 0 from (values ('${markers.row}')) as row(value) where value = '${markers.row}'`,
        ),
      ).rejects.toThrow();
      await expect(sql`select ${markers.row}::integer`).rejects.toThrow();
    } finally {
      await sql.end();
    }
    for (const path of [
      `/auth/v1/verify?token=${markers.token}&type=magiclink&redirect_to=${encodeURIComponent(`http://127.0.0.1:3210/after?code=${markers.redirect}`)}`,
      `/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(`http://127.0.0.1:3210/after?code=${markers.redirect}`)}`,
    ]) {
      const response = await fetch(`${gateway}${path}`, {
        headers: {
          apikey: anon,
          referer: `http://127.0.0.1:3210/login?code=${markers.redirect}`,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      await response.arrayBuffer();
    }
    // Let the services flush, then stop so every pipe is drained to disk.
    await runStack("stop", "e2e", { runtime: "native" });
    const files = readdirSync(layout.logs).filter((name) =>
      /\.log(\.\d+)?$/.test(name),
    );
    expect(files).toEqual(expect.arrayContaining(["postgres.log", "auth.log"]));
    for (const name of files) {
      const text = readFileSync(join(layout.logs, name), "utf8");
      for (const [kind, marker] of Object.entries(markers))
        expect(text, `${kind} in ${name}`).not.toContain(marker);
    }
    // The folder and its files are private to their owner.
    if (process.platform === "win32") {
      for (const target of [layout.logs, join(layout.logs, "postgres.log")]) {
        expect(existsSync(target)).toBe(true);
        const acl = spawnSync("icacls", [target], { encoding: "utf8" }).stdout;
        expect(acl).not.toMatch(/Everyone|BUILTIN\\Users|Authenticated Users/i);
      }
    }
  },
);
