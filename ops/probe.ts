import { createConnection } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { ENV_TABLE, type StackEnv } from "./lib/envs.js";
import { databaseUrl } from "./lib/pg.js";
import { type Runner, realRunner } from "./lib/run.js";
import { inventoryDbLogins, readDbPasswords } from "./rotate-db-passwords.js";

function hostPort(
  port: number,
  host: string,
): Promise<"open" | "refused" | "refusal unverified"> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const finish = (result: "open" | "refused" | "refusal unverified") => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish("open"));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish(error.code === "ECONNREFUSED" ? "refused" : "refusal unverified"),
    );
    socket.once("timeout", () => finish("refusal unverified"));
    socket.setTimeout(5000);
  });
}

export async function probe(
  env: StackEnv,
  runner: Runner,
): Promise<{ ok: boolean; failures: string[] }> {
  if (
    !Object.hasOwn(ENV_TABLE, env) ||
    (env === "ci" && process.env.CI !== "true")
  )
    throw new Error("Invalid stack environment");
  const port = ENV_TABLE[env].ports.db;
  const failures: string[] = [];
  const container = [
    "run",
    "--rm",
    "--network",
    "bridge",
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    "PGPASSWORD",
    "-e",
    "PGCONNECT_TIMEOUT=5",
    "postgres:17",
  ];
  let passwords: Record<string, string> = {};
  let roles: string[] = [];
  try {
    roles = await inventoryDbLogins(env, runner);
    passwords = readDbPasswords(env);
  } catch {
    failures.push(`${port}: inventory unverified`);
  }
  for (const role of [...new Set([...roles, "mdf_web", "mdf_auth"])]) {
    const args = [
      ...container,
      "psql",
      "-w",
      "-h",
      "host.docker.internal",
      "-p",
      String(port),
      "-U",
      role,
      "-d",
      "postgres",
      "-v",
      "VERBOSITY=verbose",
      "-c",
      "select 1",
    ];
    for (const mode of [
      "current",
      "default",
      ...(role.startsWith("mdf_") ? ["empty"] : []),
    ]) {
      if (mode === "current" && !passwords[role]) {
        failures.push(`${role}: current login unverified`);
        continue;
      }
      try {
        const result = await runner("docker", args, {
          env: {
            PGPASSWORD:
              mode === "current"
                ? (passwords[role] as string)
                : mode === "default"
                  ? "postgres"
                  : "",
          },
        });
        if (mode === "current") {
          if (result.code !== 0) failures.push(`${role}: current login failed`);
        } else if (result.code === 0)
          failures.push(`${role}: ${mode} login accepted`);
        else if (
          result.code !== 2 ||
          !(
            /28P01|FATAL:\s+password authentication failed for user/.test(
              result.stderr,
            ) ||
            (mode === "empty" && /no password supplied/.test(result.stderr))
          )
        )
          failures.push(`${role}: ${mode} login unverified`);
      } catch {
        failures.push(`${role}: ${mode} login unverified`);
      }
    }
  }
  // This uses the invoking Windows account. Task 35 verifies it is mdf-web.
  if (passwords.mdf_web) {
    const sql = postgres(databaseUrl("mdf_web", passwords.mdf_web, port), {
      max: 1,
      connect_timeout: 5,
      onnotice: () => {},
    });
    try {
      await sql`select 1`;
    } catch {
      failures.push("mdf_web: host login failed");
    } finally {
      await sql.end();
    }
  }
  for (const target of [port + 1, port + 2, port + 5]) {
    // Runs as the invoking account; Task 35 establishes the mdf-web identity.
    for (const address of ["127.0.0.1", "::1"]) {
      const result = await hostPort(target, address);
      if (result !== "refused")
        failures.push(`${target}: host ${address} ${result}`);
    }
    try {
      const result = await runner(
        "docker",
        [
          ...container,
          "bash",
          "-c",
          "timeout 5 bash -c 'exec 3<>/dev/tcp/host.docker.internal/$1' bash \"$1\"",
          "bash",
          String(target),
        ],
        { env: { PGPASSWORD: "" } },
      );
      if (result.code === 0) failures.push(`${target}: open`);
      else if (
        result.code !== 1 ||
        !result.stderr.includes("Connection refused")
      )
        failures.push(`${target}: refusal unverified`);
    } catch {
      failures.push(`${target}: refusal unverified`);
    }
  }
  return { ok: failures.length === 0, failures };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const env = args[1] as StackEnv;
  if (
    args.length !== 2 ||
    args[0] !== "--env" ||
    !Object.hasOwn(ENV_TABLE, env)
  ) {
    process.stderr.write("Usage: probe.ts --env <prod|dev|e2e|ci>\n");
    process.exitCode = 1;
  } else
    probe(env, realRunner)
      .then((result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exitCode = result.ok ? 0 : 1;
      })
      .catch(() => {
        process.stderr.write("Database probe failed\n");
        process.exitCode = 1;
      });
}
