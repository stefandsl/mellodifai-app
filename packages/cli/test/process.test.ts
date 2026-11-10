import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixtureDirectory } from "./runtime.js";

const pat = "mdf_test_fixture_not_a_real_token";
let dir = "";
let bundle = "";
let origin = "";
const server = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const message = JSON.parse(text);
  const result =
    message.method === "tools/list"
      ? {
          tools: [
            { name: "remake_get", annotations: { readOnlyHint: true } },
            { name: "remake_start", annotations: { readOnlyHint: false } },
          ],
        }
      : message.params.name === "remake_get"
        ? { structuredContent: { stage: "review" }, content: [] }
        : {
            isError: true,
            structuredContent: {
              error: { code: "forbidden_scope", message: "admin required" },
            },
            content: [],
          };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
});

beforeAll(async () => {
  dir = await fixtureDirectory("process-");
  bundle = join(dir, "mellodifai.js");
  await build({
    entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
    outfile: bundle,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    logLevel: "silent",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  origin = `http://127.0.0.1:${address.port}`;
  await mkdir(join(dir, "mellodifai"), { recursive: true });
  await writeFile(
    join(dir, "mellodifai", "credentials.json"),
    JSON.stringify({ url: origin, pat }),
  );
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

async function mellodifai(args: string[]) {
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [bundle, ...args],
      {
        env: { ...process.env, APPDATA: dir, TEMP: dir, TMP: dir, TMPDIR: dir },
        windowsHide: true,
      },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

it("call exits 0 with structuredContent and 1 with the tool error on stderr", async () => {
  const ok = await mellodifai(["call", "remake_get", "--json"]);
  expect(ok.code).toBe(0);
  expect(JSON.parse(ok.stdout)).toEqual({ data: { stage: "review" } });
  const failed = await mellodifai(["call", "remake_start", "--json"]);
  expect(failed.code).toBe(1);
  expect(failed.stdout).toBe("");
  expect(JSON.parse(failed.stderr)).toEqual({
    error: { code: "forbidden_scope", message: "forbidden_scope" },
  });
  expect(failed.stderr).not.toContain(pat);
}, 30000);

it("help lists every command", async () => {
  const help = await mellodifai(["--help", "--json"]);
  expect(help.code).toBe(0);
  const { commands, usage } = JSON.parse(help.stdout).data;
  for (const command of [
    "remake",
    "remakes",
    "remake-status",
    "remake-edit",
    "remake-accept",
    "remake-cancel",
    "remake-retry",
    "pick",
    "approve-video",
    "tools",
    "call",
  ])
    expect(commands).toContain(command);
  for (const command of commands) expect(usage).toContain(command);
}, 30000);
