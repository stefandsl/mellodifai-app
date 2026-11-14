import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";
import { expect, it } from "vitest";
import { portOpen, processIdentities } from "../../lib/native/host.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { readState } from "../../lib/native/processes.js";
import { nativeStatus } from "../../lib/native/stack.js";
import { statePath } from "../../lib/native/supervisor.js";
import { realRunner } from "../../lib/run.js";
import { runStack } from "../../stack.js";
import { assertNativeIntegrationEnvironment } from "./integration-env.js";

// Ten real whole-tree kills take several minutes: separately opted in.
const enabled = process.env.MDF_NATIVE_INTEGRATION === "1";

const KILLS = 10;
const SCHEMA = "mdf_shutdown_crash";

/**
 * What Windows does at logoff or shutdown to the production layout, where no
 * process can be told first (finding L2): every process of the stack ends at
 * once. The next start must run PostgreSQL's crash recovery and keep every
 * transaction whose commit was acknowledged.
 */
it.skipIf(!enabled)(
  "recovers every acknowledged commit after ten whole-tree hard kills under write load",
  async () => {
    assertNativeIntegrationEnvironment();
    const layout = nativeLayout("e2e");
    const url = process.env.TEST_DB_URL as string;
    const acknowledged = new Set<number>();
    const timings: string[] = [];
    await runStack("start", "e2e", { runtime: "native" });
    {
      const sql = postgres(url, { max: 1, onnotice: () => {} });
      await sql.unsafe(
        `drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}; create table ${SCHEMA}.writes(id bigserial primary key, kill integer not null, payload text not null)`,
      );
      await sql.end();
    }
    try {
      for (let kill = 1; kill <= KILLS; kill++) {
        const started = Date.now();
        await runStack("start", "e2e", { runtime: "native" });
        const startMs = Date.now() - started;
        const sql = postgres(url, { max: 4, onnotice: () => {} });
        // Every acknowledged commit of every earlier kill is still there.
        const rows = await sql<
          { id: string }[]
        >`select id from ${sql(SCHEMA)}.writes`;
        const present = new Set(rows.map((row) => Number(row.id)));
        const lost = [...acknowledged].filter((id) => !present.has(id));
        expect(lost, `kill ${kill - 1}: lost commits`).toEqual([]);
        await sql`select count(*) from pg_catalog.pg_class`;

        // Write load: four connections committing small transactions.
        let writing = true;
        const writers = Array.from({ length: 4 }, async () => {
          while (writing) {
            try {
              const [row] = await sql<{ id: string }[]>`
                insert into ${sql(SCHEMA)}.writes (kill, payload)
                values (${kill}, repeat(md5(random()::text), 32))
                returning id`;
              if (row) acknowledged.add(Number(row.id));
            } catch {
              return;
            }
          }
        });
        await sleep(1_500);
        const before = acknowledged.size;

        // The whole tree at once: supervisor, PostgreSQL and every service.
        const state = readState(statePath(layout));
        if (!state) throw new Error("No stack state to kill");
        const pids = [
          state.supervisor.pid,
          ...Object.values(state.services).flatMap((service) =>
            service.pid === undefined ? [] : [service.pid],
          ),
        ];
        await realRunner("taskkill", [
          "/PID",
          String(state.supervisor.pid),
          "/T",
          "/F",
        ]);
        // Anything that left the supervisor's tree is ended too.
        for (const pid of (await processIdentities(pids)).keys())
          await realRunner("taskkill", ["/PID", String(pid), "/T", "/F"]);
        writing = false;
        await Promise.all(writers);
        await sql.end({ timeout: 0 }).catch(() => {});
        expect(
          await processIdentities(pids),
          `kill ${kill}: survivors`,
        ).toEqual(new Map());
        expect(await portOpen(layout.ports.db), `kill ${kill}: db port`).toBe(
          false,
        );
        timings.push(
          `kill ${kill}: start ${startMs} ms, ${acknowledged.size - before} commits after the sample, ${acknowledged.size} acknowledged in total`,
        );
        expect(acknowledged.size).toBeGreaterThan(0);
      }
      // A clean start after the last kill, with every acknowledged commit.
      await runStack("start", "e2e", { runtime: "native" });
      expect((await nativeStatus("e2e")).healthy).toBe(true);
      const sql = postgres(url, { max: 1, onnotice: () => {} });
      const rows = await sql<
        { id: string }[]
      >`select id from ${sql(SCHEMA)}.writes`;
      const present = new Set(rows.map((row) => Number(row.id)));
      expect([...acknowledged].filter((id) => !present.has(id))).toEqual([]);
      await sql.end();
      console.log(timings.join("\n"));
    } finally {
      await runStack("start", "e2e", { runtime: "native" }).catch(() => {});
      const sql = postgres(url, { max: 1, onnotice: () => {} });
      await sql
        .unsafe(`drop schema if exists ${SCHEMA} cascade`)
        .catch(() => {});
      await sql.end({ timeout: 0 }).catch(() => {});
      await runStack("stop", "e2e", { runtime: "native" });
    }
  },
  1_800_000,
);
