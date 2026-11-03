import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { composeEnvironment } from "./compose.js";
import { ENV_TABLE, runtimePath, type StackEnv, stackDir } from "./envs.js";
import { databaseUrl, ownerConnection } from "./pg.js";
import { writePrivate } from "./private-file.js";
import { type Runner, realRunner } from "./run.js";
import { runtimeRoot } from "./runtime.js";
import { SERVICE_ORDER, serviceCommand } from "./services.js";
import { loadStackSecrets } from "./stack-secrets.js";

export async function checked(
  runner: Runner,
  cmd: string,
  args: string[],
  options?: Parameters<Runner>[2],
) {
  const reply = await runner(cmd, args, options);
  if (reply.code !== 0)
    throw new Error(
      "Recovery command failed; subprocess output withheld to protect credentials",
    );
  return reply.stdout.trim();
}

export async function stopWriters(runner: Runner) {
  for (const service of [...SERVICE_ORDER].reverse())
    if (service !== "supabase") await serviceCommand(runner, "stop", service);
}

export function dumpTables(content: string): Set<string> {
  const tables = new Set<string>();
  for (const match of content.matchAll(/^COPY ([^\s]+) \(/gmu)) {
    const name = match[1];
    if (!name || !/^(public|auth|storage)\.[a-z_][a-z0-9_]*$/u.test(name))
      throw new Error("Unsupported backup table name");
    tables.add(name);
  }
  if (!tables.size) throw new Error("Backup has no table data");
  return tables;
}

export async function recoveryDatabase(
  env: StackEnv,
  runner: Runner = realRunner,
) {
  if (env === "ci" && process.env.CI !== "true")
    throw new Error("CI requires CI=true");
  const secrets = await loadStackSecrets(env);
  const url = databaseUrl(
    "postgres",
    secrets.postgres,
    ENV_TABLE[env].ports.db,
  );
  const temp = runtimePath(
    join(env === "ci" ? dirname(stackDir(env)) : runtimeRoot(), "tmp"),
  );
  mkdirSync(temp, { recursive: true });
  const privateEnv = {
    ...composeEnvironment(env, secrets),
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    npm_config_cache: runtimePath(join(dirname(temp), "cache/npm")),
  };
  const compose = [
    "compose",
    "-p",
    ENV_TABLE[env].projectId,
    "-f",
    join(stackDir(env), "compose.json"),
  ];
  return {
    url,
    async compose(args: string[]) {
      return checked(runner, "docker", [...compose, ...args], {
        env: privateEnv,
      });
    },
    async quiesce() {
      const config = JSON.parse(
        readFileSync(join(stackDir(env), "compose.json"), "utf8"),
      );
      const services = Object.keys(config.services).filter(
        (name) => name !== "db",
      );
      await checked(runner, "docker", [...compose, "stop", ...services], {
        env: privateEnv,
      });
    },
    async backup(file: string, legacy = false) {
      runtimePath(file);
      if (existsSync(file)) throw new Error("Refusing to overwrite a backup");
      await writePrivate(file, "");
      if (legacy) {
        const data = await checked(
          runner,
          "docker",
          [
            "exec",
            "supabase_db_mellodifai",
            "pg_dump",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "--data-only",
            "--schema=public",
            "--schema=auth",
            "--schema=storage",
            "--exclude-table=auth.schema_migrations",
            "--exclude-table=storage.migrations",
            "--no-owner",
            "--no-privileges",
          ],
          { env: privateEnv },
        );
        await writePrivate(file, `${data}\n`);
      } else {
        await checked(
          runner,
          process.execPath,
          [
            createRequire(import.meta.url).resolve("supabase/dist/supabase.js"),
            "db",
            "dump",
            "--data-only",
            "--schema",
            "public,auth,storage",
            "--workdir",
            stackDir(env),
            "--db-url",
            url,
            "-f",
            file,
          ],
          { env: privateEnv },
        );
      }
      if (
        !readFileSync(file, "utf8").includes(
          "PostgreSQL database dump complete",
        )
      )
        throw new Error("Incomplete recovery backup");
    },
    async import(file: string) {
      // Keep seed rows in tables introduced after a pre-cutover backup.
      const dump = readFileSync(runtimePath(file), "utf8");
      const tables = dumpTables(dump);
      const sql = ownerConnection(url);
      let truncate: string;
      try {
        const rows = await sql`select schemaname || '.' || tablename as name,
          format('%I.%I', schemaname, tablename) as identifier
          from pg_catalog.pg_tables where schemaname in ('public', 'auth', 'storage')`;
        const selected = rows.filter((row) => tables.has(row.name));
        if (selected.length !== tables.size)
          throw new Error("Backup tables do not match the restored schema");
        truncate = `truncate table ${selected.map((row) => row.identifier).join(", ")} cascade;`;
      } finally {
        await sql.end();
      }
      await checked(
        runner,
        "docker",
        [
          ...compose,
          "exec",
          "-T",
          "db",
          "psql",
          "-U",
          "supabase_admin",
          "-d",
          "postgres",
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "--single-transaction",
          "-f",
          "-",
        ],
        {
          env: privateEnv,
          input: `set session_replication_role = replica;\n${truncate}\n${dump}\ncreate schema if not exists ops authorization postgres;\nnotify pgrst, 'reload schema';\n`,
        },
      );
    },
  };
}
