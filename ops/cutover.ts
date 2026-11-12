import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapProductionSecrets } from "./lib/bootstrap-prod.js";
import { prepareCompose } from "./lib/compose.js";
import { compareCounts, tableCounts } from "./lib/counts.js";
import { runtimePath, stackDir } from "./lib/envs.js";
import { ownerConnection } from "./lib/pg.js";
import { checked, recoveryDatabase, stopWriters } from "./lib/recovery.js";
import { prepareStackDir, renderConfig } from "./lib/render.js";
import { type Runner, realRunner } from "./lib/run.js";
import { runtimeRoot } from "./lib/runtime.js";

export type Step = {
  kind:
    | "validate"
    | "stop-writers"
    | "counts-before"
    | "backup"
    | "stop"
    | "render"
    | "start"
    | "counts-after"
    | "compare";
  env: "prod";
  projectId: "mellodifai";
};
export function planCutover(): Step[] {
  const kinds: Step["kind"][] = [
    "validate",
    "stop-writers",
    "counts-before",
    "backup",
    "stop",
    "render",
    "start",
    "counts-after",
    "compare",
  ];
  return kinds.map((kind) => ({ kind, env: "prod", projectId: "mellodifai" }));
}
export async function runCutover(
  step: (step: Step) => Promise<Record<string, number> | undefined>,
) {
  let before: Record<string, number> | undefined;
  let after: Record<string, number> | undefined;
  for (const item of planCutover()) {
    if (item.kind === "compare") {
      if (!before || !after) throw new Error("Cutover counts are missing");
      const differences = compareCounts(before, after);
      if (differences.length)
        throw new Error(
          `Cutover refused: row counts differ: ${differences.join(", ")}`,
        );
    } else {
      const counts = await step(item);
      if (item.kind === "counts-before") before = counts || undefined;
      if (item.kind === "counts-after") after = counts || undefined;
    }
  }
}
export async function productionCutover(runner: Runner = realRunner) {
  const dir = stackDir("prod");
  const marker = join(dir, "legacy-volumes.json");
  if (existsSync(marker))
    throw new Error(
      "Cutover already attempted; inspect retained volumes and counts before retrying",
    );
  const repo = runtimePath(join(runtimeRoot(), "deploy"));
  await bootstrapProductionSecrets(runner);
  const db = await recoveryDatabase("prod", runner);
  let containers: string[] = [];
  let tag = "";
  const counts = async () => {
    const sql = ownerConnection(db.url);
    try {
      return await tableCounts(sql);
    } finally {
      await sql.end();
    }
  };
  await runCutover(async (step) => {
    switch (step.kind) {
      case "validate": {
        const git = (...args: string[]) =>
          checked(runner, "git", args, { cwd: repo });
        if (
          resolve(await git("rev-parse", "--show-toplevel")) !== resolve(repo)
        )
          throw new Error("Dedicated deploy clone required");
        tag = await git("describe", "--tags", "--always", "HEAD");
        if (!/^[a-zA-Z0-9._-]+$/.test(tag))
          throw new Error("Invalid current revision");
        // Refuse an empty/new volume: Docker otherwise creates it silently.
        for (const name of [
          "supabase_db_mellodifai",
          "supabase_storage_mellodifai",
        ])
          await checked(runner, "docker", [
            "volume",
            "inspect",
            name,
            "--format",
            "{{.Name}}",
          ]);
        const output = await checked(runner, "docker", [
          "ps",
          "-a",
          "--filter",
          "label=com.supabase.cli.project=mellodifai",
          "--format",
          "{{.Names}}",
        ]);
        containers = output.split(/\r?\n/).filter(Boolean);
        if (
          !containers.includes("supabase_db_mellodifai") ||
          !containers.includes("supabase_storage_mellodifai") ||
          containers.some(
            (name) => !/^supabase_[a-z0-9_]+_mellodifai$/.test(name),
          )
        )
          throw new Error("Expected the existing CLI production containers");
        for (const [container, destination] of [
          ["supabase_db_mellodifai", "/var/lib/postgresql/data"],
          ["supabase_storage_mellodifai", "/mnt"],
        ]) {
          const mounts = JSON.parse(
            await checked(runner, "docker", [
              "inspect",
              container as string,
              "--format",
              "{{json .Mounts}}",
            ]),
          ) as { Type: string; Name: string; Destination: string }[];
          if (
            !mounts.some(
              (mount) =>
                mount.Type === "volume" &&
                mount.Name === container &&
                mount.Destination === destination,
            )
          )
            throw new Error(
              "Existing production mount does not match the cutover volume",
            );
        }
        prepareStackDir(dir, repo);
        await counts();
        break;
      }
      case "stop-writers":
        await stopWriters(runner);
        await checked(runner, "docker", [
          "stop",
          ...containers.filter((name) => name !== "supabase_db_mellodifai"),
        ]);
        break;
      case "counts-before": {
        const result = await counts();
        // Counts contain only table names and totals, never credentials or rows.
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "cutover-counts-before.json"),
          JSON.stringify(result),
        );
        return result;
      }
      case "backup": {
        await db.backup(
          join(
            runtimeRoot(),
            "backups",
            `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${tag}.sql`,
          ),
          true,
        );
        break;
      }
      case "stop":
        await checked(runner, "docker", ["stop", ...containers]);
        break;
      case "render":
        writeFileSync(
          marker,
          JSON.stringify({
            db: "supabase_db_mellodifai",
            storage: "supabase_storage_mellodifai",
          }),
        );
        prepareStackDir(dir, repo);
        {
          const toml = renderConfig(
            readFileSync(join(repo, "supabase/config.toml"), "utf8"),
            "prod",
            dir,
          );
          writeFileSync(join(dir, "supabase/config.toml"), toml);
          prepareCompose("prod", toml);
        }
        break;
      case "start":
        // No migrations here: compare the unchanged database before any deploy.
        await db.compose([
          "up",
          "-d",
          "--pull",
          "never",
          "--wait",
          "--wait-timeout",
          "180",
        ]);
        await db.compose(["restart", "kong"]);
        break;
      case "counts-after": {
        const result = await counts();
        writeFileSync(
          join(dir, "cutover-counts-after.json"),
          JSON.stringify(result),
        );
        return result;
      }
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  (async () => {
    if (process.argv.length !== 2) throw new Error("Usage: cutover.ts");
    await productionCutover();
  })().catch(() => {
    process.stderr.write(
      "Cutover failed; do not start application services. Inspect retained volumes and cutover count files. Subprocess output withheld.\n",
    );
    process.exitCode = 1;
  });
