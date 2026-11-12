import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probe } from "../probe.js";
import { reapplyDbPasswords } from "../rotate-db-passwords.js";
import { ENV_TABLE, runtimePath } from "./envs.js";
import type { Runner } from "./run.js";
import { realRunner } from "./run.js";
import { runtimeRoot } from "./runtime.js";
import {
  ServiceOperationError,
  serviceFailureReason,
} from "./service-error.js";
import { SMTP_SETUP_NOTICE } from "./smtp.js";

export const SERVICE_ORDER = [
  "supabase",
  "worker",
  "auth",
  "web",
  "edge",
  "cloudflared",
] as const;
export type Service = (typeof SERVICE_ORDER)[number];
export function authServiceCommand(root: string) {
  const cwd = join(runtimePath(root), "deploy/apps/auth");
  return {
    cmd: process.execPath,
    cwd,
    args: [`--env-file=${join(cwd, ".env.local")}`, "dist/src/main.js"],
  };
}
export function edgeServiceCommand(root: string) {
  const cwd = join(runtimePath(root), "deploy");
  return {
    cmd: process.execPath,
    cwd,
    args: [join(cwd, "ops/dist/edge-proxy.js")],
  };
}
export const LISTENERS = {
  3000: "mdf-web",
  3010: "mdf-auth",
  3080: "mdf-web",
} as const;

export function installCommands(opts: { root: string }): string[][] {
  const root = runtimePath(opts.root);
  const owner = userInfo().username;
  const deploy = join(root, "deploy");
  const quote = (path: string) => `'${path.replaceAll("'", "''")}'`;
  const directories = [
    join(deploy, "apps/web/.next/cache"),
    join(root, "secrets/auth"),
    join(root, "secrets/cloudflared"),
    join(root, "stacks"),
    join(root, "backups"),
  ];
  const envFiles = ["web", "auth", "worker"].map((app) =>
    join(deploy, "apps", app, ".env.local"),
  );
  const grant = (
    path: string,
    account: string,
    rights: string,
    file = false,
  ) => [
    "icacls",
    path,
    "/inheritance:r",
    "/grant:r",
    `${owner}:${file ? "" : "(OI)(CI)"}F`,
    `SYSTEM:${file ? "" : "(OI)(CI)"}F`,
    `${account}:${file ? "" : "(OI)(CI)"}${rights}`,
  ];
  return [
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }",
    ],
    ...aclCommands(root),
    // Reset descendant ACLs while their parent permits only the owner and SYSTEM.
    // /L changes links themselves rather than following them outside these trees.
    ...["deploy", "secrets", "stacks", "backups"].map((name) => [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; $path='${join(root, name).replaceAll("'", "''")}'; if (Test-Path -LiteralPath $path) { & icacls $path /reset /T /L /Q | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Protected ACL reset failed' } }`,
    ]),
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; $deploy=${quote(deploy)}; if (-not (Test-Path -LiteralPath $deploy -PathType Container)) { throw 'Deploy clone required' }; foreach ($dir in @(${directories.map(quote).join(",")})) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; foreach ($file in @(${envFiles.map(quote).join(",")})) { if (Test-Path -LiteralPath $file) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Expected env file' } } else { New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force | Out-Null; New-Item -ItemType File -Path $file | Out-Null } }`,
    ],
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `New-Item -ItemType Directory -Force -Path '${join(root, "secrets/services").replaceAll("'", "''")}' | Out-Null`,
    ],
    ...aclCommands(join(root, "secrets/services")),
    ...["mdf-web", "mdf-auth", "mdf-tunnel"].map((account) => [
      "powershell.exe",
      "-NoProfile",
      "-Command",
      `$ErrorActionPreference='Stop'; $dir='${join(root, "secrets/services").replaceAll("'", "''")}'; $name=$env:COMPUTERNAME+'\\${account}'; $file=Join-Path $dir '${account}.xml'; $user=Get-LocalUser -Name '${account}' -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $file) { $credential=Import-Clixml -LiteralPath $file; if ($credential.UserName -ine $name) { throw 'Credential identity mismatch' }; if (-not $user) { New-LocalUser -Name '${account}' -Password $credential.Password -PasswordNeverExpires | Out-Null } } else { $bytes=New-Object byte[] 48; $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }; $plain=[Convert]::ToBase64String($bytes)+'Aa1!'; $secure=ConvertTo-SecureString $plain -AsPlainText -Force; if ($user) { Set-LocalUser -Name '${account}' -Password $secure } else { New-LocalUser -Name '${account}' -Password $secure -PasswordNeverExpires | Out-Null }; $credential=[pscredential]::new($name,$secure); $credential | Export-Clixml -LiteralPath $file; $plain=$null }`,
    ]),
    ["icacls", root, "/grant", "mdf-web:(X)", "mdf-auth:(X)", "mdf-tunnel:(X)"],
    grant(deploy, "mdf-web", "RX"),
    ["icacls", deploy, "/grant", "mdf-auth:(OI)(CI)RX"],
    [
      "icacls",
      dirname(process.execPath),
      "/grant",
      "mdf-web:(OI)(CI)RX",
      "mdf-auth:(OI)(CI)RX",
    ],
    grant(join(deploy, "apps/web/.next/cache"), "mdf-web", "M"),
    grant(join(deploy, "apps/web/.env.local"), "mdf-web", "R", true),
    grant(join(deploy, "apps/auth/.env.local"), "mdf-auth", "R", true),
    grant(join(root, "secrets/auth"), "mdf-auth", "R"),
    grant(join(root, "secrets/cloudflared"), "mdf-tunnel", "R"),
    ...[
      join(deploy, "apps/worker/.env.local"),
      join(root, "stacks"),
      join(root, "backups"),
    ].map((path) => [
      "icacls",
      path,
      "/inheritance:r",
      "/grant:r",
      `${owner}:(OI)(CI)F`,
      "SYSTEM:(OI)(CI)F",
    ]),
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; $rules=Get-NetFirewallRule -DisplayName 'MellodifAI block LAN' -ErrorAction SilentlyContinue; if ($rules) { $rules | Set-NetFirewallRule -Enabled True -Profile Any -Direction Inbound -Action Block -Protocol TCP -LocalPort 3000,3001,3010,3080,4007,8188,${ENV_TABLE.prod.ports.api}-${ENV_TABLE.prod.listeners.pooler} -RemoteAddress LocalSubnet } else { New-NetFirewallRule -DisplayName 'MellodifAI block LAN' -Enabled True -Profile Any -Direction Inbound -Action Block -Protocol TCP -LocalPort 3000,3001,3010,3080,4007,8188,${ENV_TABLE.prod.ports.api}-${ENV_TABLE.prod.listeners.pooler} -RemoteAddress LocalSubnet }`,
    ],
  ];
}

export function aclProbePaths(account: string, root: string) {
  if (!["mdf-web", "mdf-auth", "mdf-tunnel"].includes(account))
    throw new Error("Unknown service account");
  runtimePath(root);
  const walk = (
    path: string,
    excluded = "",
    seen = new Set<string>(),
  ): Array<{ path: string; directory: boolean }> => {
    if (!existsSync(path) || path === excluded) return [];
    const resolved = realpathSync(path);
    runtimePath(resolved);
    if (seen.has(resolved)) return [];
    seen.add(resolved);
    const directory = lstatSync(resolved).isDirectory();
    return [
      { path: resolved, directory },
      ...(directory
        ? readdirSync(resolved).flatMap((name) =>
            walk(join(resolved, name), excluded, seen),
          )
        : []),
    ];
  };
  const secretRoot = join(root, "secrets");
  const own =
    account === "mdf-auth"
      ? "auth"
      : account === "mdf-tunnel"
        ? "cloudflared"
        : "";
  const secrets = existsSync(secretRoot)
    ? readdirSync(secretRoot)
        .filter((name) => name !== own)
        .map((name) => join(secretRoot, name))
    : [];
  const reads = [
    ...secrets,
    join(root, "stacks"),
    join(root, "backups"),
    ...["web", "auth", "worker"]
      .filter((app) => account !== `mdf-${app}`)
      .map((app) => join(root, "deploy/apps", app, ".env.local")),
  ]
    .flatMap((path) => walk(path))
    .filter((entry) => !entry.directory)
    .map((entry) => entry.path);
  const cache =
    account === "mdf-web"
      ? realpathSafe(join(root, "deploy/apps/web/.next/cache"))
      : "";
  const writes = ["deploy", "ComfyUI_windows_portable", "tmp", "wt"].flatMap(
    (name) => walk(join(root, name), cache),
  );
  return { reads, writes };
}

function realpathSafe(path: string) {
  return existsSync(path) ? realpathSync(path) : path;
}

export async function icaclsProbe(
  account: string,
  root = runtimeRoot(),
  runner: Runner = realRunner,
): Promise<string[]> {
  const paths = aclProbePaths(account, root);
  const credential = join(
    root,
    "secrets/services",
    `${account}.xml`,
  ).replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $payload=[Console]::In.ReadToEnd(); $credential=Import-Clixml -LiteralPath '${credential}'; if ($credential.UserName -ine ($env:COMPUTERNAME+'\\${account}')) { throw 'Credential identity mismatch' }; $job=Start-Job -Credential $credential -ArgumentList $payload -ScriptBlock {
    param($json)
    $ErrorActionPreference='Stop'
    $paths=ConvertFrom-Json $json
    foreach($path in $paths.reads) {
      try { $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); $stream.Dispose(); 'read:'+$path }
      catch [System.UnauthorizedAccessException] {}
    }
    foreach($entry in $paths.writes) {
      $path=$entry.path; $created=$false
      try {
        if($entry.directory) { $path=Join-Path $path ('.mdf-acl-probe-'+[guid]::NewGuid().ToString('N')); $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write); $created=$true }
        else { $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite) }
        $stream.Dispose(); 'write:'+$entry.path
      } catch [System.UnauthorizedAccessException] {}
      finally { if($created) { Remove-Item -LiteralPath $path -Force } }
    }
  }; $job | Wait-Job | Out-Null; if($job.State -ne 'Completed' -or $job.ChildJobs[0].Error.Count) { throw 'ACL probe failed' }; Receive-Job $job; Remove-Job $job`;
  const result = await runner(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { input: JSON.stringify(paths) },
  );
  if (result.code !== 0)
    throw new Error(`ACL probe could not run as ${account}`);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

export async function portOwners(
  runner: Runner = realRunner,
): Promise<Record<number, string>> {
  const script =
    "$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen -LocalPort 3000,3010,3080 -ErrorAction SilentlyContinue | ForEach-Object { $p=Get-Process -Id $_.OwningProcess -IncludeUserName -ErrorAction Stop; [pscustomobject]@{port=$_.LocalPort; owner=$p.UserName} }) | ConvertTo-Json -Compress";
  const result = await runner("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  if (result.code !== 0) throw new Error("Cannot inspect port owners");
  const rows = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  const owners: Record<number, string> = {};
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    const port = Number(row.port);
    const owner = String(row.owner ?? "").toLowerCase();
    if (
      !(port in LISTENERS) ||
      !/^[^\\]+\\[^\\]+$/.test(owner) ||
      (owners[port] && owners[port] !== owner)
    )
      throw new Error("Port owner mismatch");
    owners[port] = owner;
  }
  return owners;
}

export function watchPorts(
  expected: Record<number, string>,
  onMismatch: () => void | Promise<void>,
  everyMs = 60000,
  owners: () => Promise<Record<number, string>> = portOwners,
): () => void {
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    let mismatch = false;
    try {
      const actual = await owners();
      mismatch = Object.entries(expected).some(
        ([port, owner]) =>
          actual[Number(port)]?.toLowerCase() !== owner.toLowerCase(),
      );
    } catch {
      mismatch = true;
    } finally {
      checking = false;
    }
    if (mismatch) {
      try {
        await onMismatch();
        clearInterval(timer);
      } catch {
        // Retry until the tunnel has actually stopped.
      }
    }
  }, everyMs);
  return () => clearInterval(timer);
}

export async function expectedPortOwners(
  runner: Runner = realRunner,
): Promise<Record<number, string>> {
  const result = await runner("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$ErrorActionPreference='Stop'; $owner=[Security.Principal.WindowsIdentity]::GetCurrent().Name; $web=$owner; $auth=$owner; if (Get-LocalUser -Name 'mdf-web' -ErrorAction SilentlyContinue) { $web=$env:COMPUTERNAME+'\\mdf-web' }; if (Get-LocalUser -Name 'mdf-auth' -ErrorAction SilentlyContinue) { $auth=$env:COMPUTERNAME+'\\mdf-auth' }; @{'3000'=$web;'3010'=$auth;'3080'=$web} | ConvertTo-Json -Compress",
  ]);
  if (result.code !== 0) throw new Error("Cannot inspect service accounts");
  const owners = JSON.parse(result.stdout);
  return Object.fromEntries(
    Object.keys(LISTENERS).map((port) => {
      const owner = String(owners[port] ?? "").toLowerCase();
      if (!/^[^\\]+\\[^\\]+$/.test(owner))
        throw new Error("Invalid expected port owner");
      return [Number(port), owner];
    }),
  );
}

export function planStart(present: Set<Service>): Service[] {
  return SERVICE_ORDER.filter((service) => present.has(service));
}

export async function serviceCommand(
  runner: Runner,
  action: "start" | "stop" | "status",
  service: Service,
  root = runtimeRoot(),
) {
  const result = await runner(
    process.execPath,
    [
      createRequire(import.meta.url).resolve("tsx/cli"),
      fileURLToPath(new URL("../services.ts", import.meta.url)),
      `__${action}`,
      service,
    ],
    { env: { MELLODIFAI_ROOT: runtimePath(root) } },
  );
  if (result.code !== 0)
    throw new ServiceOperationError(action, service, `exit ${result.code}`);
  if (
    service === "supabase" &&
    action === "start" &&
    result.stderr.split(/\r?\n/).includes(SMTP_SETUP_NOTICE)
  )
    console.warn(SMTP_SETUP_NOTICE);
  return result.stdout.trim();
}

export async function startAll(
  runner: Runner,
  opts: { root: string; present: Set<Service> },
): Promise<void> {
  runtimePath(opts.root);
  // Task 8's environment table is initialized at process startup.
  if (resolve(opts.root) !== resolve(runtimeRoot()))
    throw new Error("Set MELLODIFAI_ROOT before starting services");
  if (opts.present.has("cloudflared") && !opts.present.has("supabase"))
    throw new Error("cloudflared requires a verified supabase start");
  // A tracked tunnel may outlive its configuration in the target checkout.
  if (opts.present.has("supabase"))
    await serviceCommand(runner, "stop", "cloudflared", opts.root);
  for (const service of planStart(opts.present)) {
    if (service === "cloudflared") {
      const expected = await expectedPortOwners(runner);
      try {
        await waitForPortOwners(runner, expected);
      } catch (error) {
        await serviceCommand(runner, "stop", "cloudflared", opts.root);
        throw error;
      }
    }
    await serviceCommand(runner, "start", service, opts.root);
    if (service === "supabase") {
      try {
        await reapplyDbPasswords("prod", runner);
        if (!(await probe("prod", runner)).ok)
          throw new Error(
            "Production database probe failed; tunnel start refused",
          );
      } catch (error) {
        throw new ServiceOperationError(
          "database provisioning/probe",
          service,
          `${serviceFailureReason(error)}; verify 127.0.0.1:${ENV_TABLE.prod.ports.api}/${ENV_TABLE.prod.ports.db} and Windows excluded port ranges; tunnel start refused`,
        );
      }
    }
  }
}

/** Process creation precedes listener readiness. Never wait on a wrong owner. */
export async function waitForPortOwners(
  runner: Runner,
  expected: Record<number, string>,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const actual = await portOwners(runner);
    const entries = Object.entries(expected);
    if (
      entries.some(
        ([port, owner]) =>
          actual[Number(port)] && actual[Number(port)] !== owner,
      )
    )
      throw new Error("Port owner mismatch; cloudflared start refused");
    if (entries.every(([port, owner]) => actual[Number(port)] === owner))
      return;
    if (Date.now() >= deadline)
      throw new Error(
        "Upstream listener readiness timed out; cloudflared start refused",
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function stopAll(
  runner: Runner,
  services: Service[],
): Promise<void> {
  for (const service of planStart(new Set(services)).reverse())
    await serviceCommand(runner, "stop", service);
}

export function aclCommands(root: string): string[][] {
  const path = runtimePath(root);
  return [
    [
      "icacls",
      path,
      "/inheritance:r",
      "/grant:r",
      `${userInfo().username}:(OI)(CI)F`,
      "SYSTEM:(OI)(CI)F",
    ],
    // /grant:r replaces only named grants, so remove other explicit grants too.
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; $path='${path.replaceAll("'", "''")}'; $acl=Get-Acl -LiteralPath $path; $owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach ($rule in @($acl.Access)) { $sid=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if ($sid -ne $owner -and $sid -ne 'S-1-5-18') { & icacls $path /remove ([string]::Concat('*', $sid)) | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'ACL removal failed' } } }`,
    ],
  ];
}
