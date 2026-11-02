import { createRequire } from "node:module";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probe } from "../probe.js";
import { reapplyDbPasswords } from "../rotate-db-passwords.js";
import { runtimePath } from "./envs.js";
import type { Runner } from "./run.js";
import { runtimeRoot } from "./runtime.js";

export const SERVICE_ORDER = [
  "supabase",
  "worker",
  "auth",
  "web",
  "edge",
  "cloudflared",
] as const;
export type Service = (typeof SERVICE_ORDER)[number];

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
    throw new Error(`Service ${action} failed: ${service}`);
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
    await serviceCommand(runner, "start", service, opts.root);
    if (service === "supabase") {
      await reapplyDbPasswords("prod", runner);
      if (!(await probe("prod", runner)).ok)
        throw new Error(
          "Production database probe failed; tunnel start refused",
        );
    }
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
