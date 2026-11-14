// FROZEN scorer of the autoresearch run "nov14-f1" (PIANO-UNIFICATO.md, phase F1).
// Runs apps/web/e2e/audit.spec.ts on the running e2e lab stack and prints `defects: <n>` and a
// breakdown per category. Needs the lab env (test.env), WORKER_FAKE=1 and MELLODIFAI_ROOT.
// Usage: pnpm ops autoresearch/eval-f1.ts [--list]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.MELLODIFAI_ROOT;
if (!root) throw new Error("MELLODIFAI_ROOT is required");
if (process.env.WORKER_FAKE !== "1")
  throw new Error("WORKER_FAKE=1 is required");
const out = join(root, "test-results/audit/defects.jsonl");
rmSync(out, { force: true });
const web = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run through pnpm ops");
const started = Date.now();
const run = spawnSync(
  process.execPath,
  [pnpm, "exec", "playwright", "test", "e2e/audit.spec.ts", "--reporter=line"],
  {
    cwd: web,
    env: { ...process.env, MDF_AUDIT: "1", MDF_AUDIT_OUT: out },
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  },
);
const minutes = ((Date.now() - started) / 60_000).toFixed(1);
if (run.status !== 0) {
  console.log(`defects: crash (playwright exit ${run.status}, ${minutes} min)`);
  process.exit(1);
}
type Defect = {
  category: string;
  page: string;
  viewport: string;
  detail: string;
};
const defects: Defect[] = existsSync(out)
  ? readFileSync(out, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Defect)
  : [];
const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0, e: 0, f1: 0 };
for (const d of defects) counts[d.category] = (counts[d.category] ?? 0) + 1;
console.log(`defects: ${defects.length}`);
console.log(
  Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" "),
  `(${minutes} min)`,
);
if (process.argv.includes("--list"))
  for (const d of defects)
    console.log(`${d.category}\t${d.viewport}\t${d.page}\t${d.detail}`);
