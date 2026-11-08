import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import { composeEnvironment } from "./lib/compose.js";
import { ENV_TABLE, runtimePath, stackDir } from "./lib/envs.js";
import { realRunner } from "./lib/run.js";
import { runtimeRoot } from "./lib/runtime.js";
import { serviceErrorMessage } from "./lib/service-error.js";
import {
  aclCommands,
  authServiceCommand,
  edgeServiceCommand,
  expectedPortOwners,
  icaclsProbe,
  installCommands,
  planStart,
  SERVICE_ORDER,
  type Service,
  serviceCommand,
  startAll,
  stopAll,
  waitForPortOwners,
} from "./lib/services.js";
import { loadStackSecrets } from "./lib/stack-secrets.js";
import { workerEnvFile } from "./lib/worker-env.js";
import { probe } from "./probe.js";
import { reapplyDbPasswords } from "./rotate-db-passwords.js";
import { planStackCommand } from "./stack.js";

// Keep the console attached for Windows credential prompts; capture output for the ACL probe.
const interactiveRunner: typeof realRunner = (cmd, args, opts) => {
  if (opts?.input !== undefined) return realRunner(cmd, args, opts);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
};

export function presentServices(root: string): Set<Service> {
  const deploy = join(runtimePath(root), "deploy");
  const present = new Set<Service>();
  if (existsSync(join(root, "stacks/prod/compose.json")))
    present.add("supabase");
  for (const app of ["worker", "auth", "web"] as const)
    if (existsSync(join(deploy, "apps", app, "package.json"))) present.add(app);
  if (existsSync(join(deploy, "ops/edge-proxy.ts"))) present.add("edge");
  if (existsSync(join(root, "secrets/cloudflared/config.yml")))
    present.add("cloudflared");
  return present;
}

export function assertTunnelConfig(config: string, template: string): void {
  const expected = parse(readFileSync(template, "utf8")).ingress;
  if (
    !Array.isArray(expected) ||
    !isDeepStrictEqual(parse(readFileSync(config, "utf8")).ingress, expected)
  )
    throw new Error("Tunnel ingress drift; start refused");
}

// Creation time prevents a stale PID record from stopping an unrelated process.
async function identity(pid: number): Promise<string> {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("Invalid service PID");
  const reply = await realRunner("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') }`,
  ]);
  if (reply.code !== 0) throw new Error("Cannot inspect service process");
  return reply.stdout.trim();
}

export async function managedService(
  action: string,
  service: Service,
  root: string,
) {
  if (process.platform !== "win32")
    throw new Error("Production services require Windows");
  const logs = runtimePath(join(root, "logs"));
  mkdirSync(logs, { recursive: true });
  if (service === "supabase") {
    const secrets = await loadStackSecrets("prod", true);
    const env = composeEnvironment("prod", secrets);
    if (action === "status") {
      const result = await realRunner(
        "docker",
        [
          "compose",
          "-p",
          ENV_TABLE.prod.projectId,
          "-f",
          join(stackDir("prod"), "compose.json"),
          "ps",
          "--format",
          "json",
        ],
        { env },
      );
      if (result.code !== 0) throw new Error("Cannot inspect Supabase");
      // Compose status may include environment-bearing command lines. Print only state.
      const rows = result.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => JSON.parse(line));
      process.stdout.write(
        `${rows.length && rows.every((row: { State: string }) => row.State === "running") ? "running" : "stopped or partial"}\n`,
      );
      return;
    }
    for (const [cmd, ...args] of planStackCommand(action, "prod", {})) {
      const result = await realRunner(cmd as string, args, { env });
      // Do not retain Docker output, which can contain credentials.
      writeFileSync(
        join(logs, "supabase.log"),
        `${new Date().toISOString()} ${action}: ${result.code}\n`,
        { flag: "a" },
      );
      if (result.code !== 0) throw new Error("Supabase command failed");
    }
    return;
  }
  const stateFile = runtimePath(join(logs, `${service}.pid.json`));
  let running = false;
  let pid = 0;
  if (existsSync(stateFile)) {
    const state = JSON.parse(
      readFileSync(stateFile, "utf8").replace(/^\uFEFF/, ""),
    ) as {
      pid: number;
      identity: string;
    };
    pid = state.pid;
    running =
      Boolean(state.identity) && (await identity(pid)) === state.identity;
  }
  if (action === "status") {
    process.stdout.write(`${running ? "running" : "stopped"}\n`);
    return;
  }
  if (action === "stop") {
    if (running) {
      const result = await realRunner("taskkill.exe", [
        "/PID",
        String(pid),
        "/T",
        "/F",
      ]);
      if (result.code !== 0)
        throw new Error("Cannot stop service process tree");
    }
    if (existsSync(stateFile)) unlinkSync(stateFile);
    return;
  }
  if (running) return;
  const deploy = runtimePath(join(root, "deploy"));
  let cwd = deploy;
  let cmd = process.execPath;
  let args: string[] = [];
  if (service === "edge") {
    ({ cmd, args, cwd } = edgeServiceCommand(root));
  } else if (service === "cloudflared") {
    const config = join(root, "secrets/cloudflared/config.yml");
    const template = join(deploy, "ops/cloudflared/config.template.yml");
    assertTunnelConfig(config, template);
    await reapplyDbPasswords("prod", realRunner);
    if (!(await probe("prod", realRunner)).ok)
      throw new Error("Production database probe failed; tunnel start refused");
    const expectedOwners = await expectedPortOwners();
    await waitForPortOwners(realRunner, expectedOwners);
    cmd = "cloudflared";
    args = ["tunnel", "--config", config, "run"];
  } else if (service === "auth") {
    ({ cmd, args, cwd } = authServiceCommand(root));
  } else if (service === "web") {
    cwd = join(deploy, "apps/web");
    args = [
      join(cwd, "node_modules/next/dist/bin/next"),
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      "3000",
    ];
  } else {
    cwd = join(deploy, "apps", service);
    const pnpm = process.env.npm_execpath;
    if (!pnpm || !existsSync(pnpm))
      throw new Error("Run services through pnpm ops");
    args = [pnpm, "start"];
  }
  const temp = runtimePath(join(root, "tmp"));
  mkdirSync(temp, { recursive: true });
  await launchHostedService({ root, service, cmd, args, cwd, stateFile });
}

export const SERVICE_ACCOUNTS: Partial<Record<Service, string>> = {
  web: "mdf-web",
  edge: "mdf-web",
  auth: "mdf-auth",
  cloudflared: "mdf-tunnel",
};

export async function launchHostedService(opts: {
  root: string;
  service: Service;
  cmd: string;
  args: string[];
  cwd: string;
  stateFile: string;
}) {
  const { root, service, cmd, args, cwd, stateFile } = opts;
  const logs = runtimePath(join(root, "logs"));
  const temp = runtimePath(join(root, "tmp"));
  mkdirSync(logs, { recursive: true });
  mkdirSync(temp, { recursive: true });
  const manifest = join(logs, `${service}.launch.json`);
  // Windows CommandLineToArgvW quoting, including trailing backslashes.
  const quote = (arg: string) =>
    `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
  writeFileSync(
    manifest,
    JSON.stringify({
      root,
      account: SERVICE_ACCOUNTS[service],
      command: cmd,
      arguments: args.map(quote).join(" "),
      cwd,
      state: stateFile,
      stdout: join(logs, `${service}.log`),
      stderr: join(logs, `${service}.error.log`),
      ports: service === "cloudflared" ? await expectedPortOwners() : null,
    }),
  );
  const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const hostArgs = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    fileURLToPath(new URL("./service-host.ps1", import.meta.url)),
    "-Manifest",
    manifest,
  ]
    .map(quote)
    .join(" ");
  const started = await realRunner(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; $p=Start-Process powershell.exe -ArgumentList ${psQuote(hostArgs)} -WindowStyle Hidden -PassThru; $p.Id`,
    ],
    {
      cwd,
      env: {
        MELLODIFAI_ROOT: root,
        HOST: "127.0.0.1",
        ...(service === "worker"
          ? { WORKER_ENV_FILES: runtimePath(workerEnvFile(root)) }
          : {}),
        TEMP: temp,
        TMP: temp,
        TMPDIR: temp,
        npm_config_cache: join(root, "cache/npm"),
        npm_config_store_dir: join(root, "cache/pnpm"),
      },
    },
  );
  const hostPid = Number(started.stdout.trim());
  if (started.code !== 0 || !Number.isSafeInteger(hostPid) || hostPid <= 0)
    throw new Error("Cannot launch service host");
  const hostIdentity = await identity(hostPid);
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!hostIdentity || (await identity(hostPid)) !== hostIdentity)
        throw new Error("Service host exited before readiness");
      if (existsSync(stateFile)) {
        const state = JSON.parse(
          readFileSync(stateFile, "utf8").replace(/^\uFEFF/, ""),
        );
        if (state.supervisorPid === hostPid) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Service host readiness timed out");
  } catch (error) {
    if (hostIdentity && (await identity(hostPid)) === hostIdentity)
      await realRunner("taskkill.exe", ["/PID", String(hostPid), "/T", "/F"]);
    throw error;
  }
}

export async function main(
  args: string[],
  installRunner = interactiveRunner,
  checkAcl = icaclsProbe,
) {
  const [action, flag] = args;
  const root = runtimePath(runtimeRoot());
  if (action === "acl" && args.length <= 2 && (!flag || flag === "--apply")) {
    for (const [cmd, ...commandArgs] of aclCommands(root)) {
      process.stdout.write(
        `${[cmd, ...commandArgs].map((part) => `"${part}"`).join(" ")}\n`,
      );
      if (flag === "--apply") {
        const result = await installRunner(cmd as string, commandArgs);
        if (result.code !== 0)
          throw new Error(
            "Runtime ACL refused; owner administrator action pending",
          );
      }
    }
    return;
  }
  if (
    action === "install" &&
    args.length <= 2 &&
    (!flag || flag === "--apply")
  ) {
    const commands = installCommands({ root });
    for (const [cmd, ...commandArgs] of commands) {
      process.stdout.write(
        `${[cmd, ...commandArgs].map((part) => `"${part}"`).join(" ")}\n`,
      );
      if (flag === "--apply") {
        const result = await installRunner(cmd as string, commandArgs);
        if (result.code !== 0)
          throw new Error(
            `step ${cmd} exited ${result.code}${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
          );
      }
    }
    if (flag === "--apply") {
      for (const account of ["mdf-web", "mdf-auth", "mdf-tunnel"]) {
        const violations = await checkAcl(account, root, installRunner);
        if (violations.length)
          throw new Error(
            `ACL probe failed for ${account}: ${violations.join(", ")}`,
          );
      }
    }
    return;
  }
  if (
    action?.startsWith("__") &&
    args.length === 2 &&
    SERVICE_ORDER.includes(flag as Service) &&
    ["__start", "__stop", "__status"].includes(action)
  ) {
    await managedService(action.slice(2), flag as Service, root);
    return;
  }
  if (args.length !== 1 || !["start", "stop", "status"].includes(action ?? ""))
    throw new Error(
      "Usage: services.ts <start|stop|status|acl [--apply]|install [--apply]>",
    );
  if (action === "start")
    await startAll(realRunner, { root, present: presentServices(root) });
  else if (action === "stop") {
    const present = presentServices(root);
    for (const service of SERVICE_ORDER)
      if (existsSync(join(root, "logs", `${service}.pid.json`)))
        present.add(service);
    await stopAll(realRunner, [...present]);
  } else
    for (const service of planStart(presentServices(root)))
      process.stdout.write(
        `${service}: ${await serviceCommand(realRunner, "status", service, root)}\n`,
      );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${serviceErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
