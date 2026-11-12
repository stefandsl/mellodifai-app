import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { runtimePath, type StackEnv, stackDir } from "./envs.js";
import { type Runner, realRunner } from "./run.js";
import { runtimeRoot } from "./runtime.js";

export const PRODUCTION_SMTP = {
  enabled: true,
  host: "smtp.resend.com",
  port: 465,
  user: "resend",
  pass: "env(MDF_SMTP_PASS)",
  admin_email: "no-reply@mellodifai.com",
  sender_name: "MellodifAI",
};

export const SMTP_SETUP_NOTICE =
  "SMTP disabled: create secrets/smtp.env under MELLODIFAI_ROOT (default E:/mellodifai) with MDF_SMTP_PASS and owner-only ACL.";

/** Only Compose receives this map; never mutate the parent/service environment. */
export async function loadSmtpEnvironment(
  env: StackEnv,
  log: (message: string) => void = console.warn,
  runner: Runner = realRunner,
): Promise<Record<string, string>> {
  if (env !== "prod") return { MDF_SMTP_PASS: "" };
  const path = runtimePath(join(runtimeRoot(), "secrets/smtp.env"));
  try {
    if (!existsSync(path)) throw new Error("Missing SMTP file");
    if (process.platform === "win32") {
      const acl = await runner(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:MDF_SMTP_FILE; $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner -or -not $acl.AreAccessRulesProtected) { exit 1 }; foreach ($rule in $acl.Access) { $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if ($rule.AccessControlType -eq 'Allow' -and $sid -ne $owner -and $sid -ne 'S-1-5-18') { exit 1 } }",
        ],
        { env: { MDF_SMTP_FILE: path, MDF_SMTP_PASS: "" } },
      );
      if (acl.code !== 0) throw new Error("Unsafe SMTP ACL");
    } else if ((statSync(path).mode & 0o077) !== 0) {
      throw new Error("Unsafe SMTP permissions");
    }
    const value = parseEnv(readFileSync(path, "utf8")).MDF_SMTP_PASS;
    if (!value?.trim() || /[\r\n\0]/.test(value))
      throw new Error("Missing SMTP value");
    return { MDF_SMTP_PASS: value };
  } catch {
    // Neither file contents nor arbitrary filesystem/subprocess errors are safe.
    log(SMTP_SETUP_NOTICE);
    return { MDF_SMTP_PASS: "" };
  }
}

export interface SmtpConfig {
  enabled?: boolean;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  admin_email?: string;
  sender_name?: string;
}

/** Empty credentials also clear the host, so GoTrue starts without SMTP. */
export function smtpEnvironment(smtp: SmtpConfig): Record<string, string> {
  const reference = /^env\(([A-Z_][A-Z0-9_]*)\)$/.exec(smtp.pass ?? "");
  if (!reference)
    throw new Error("SMTP credentials must use an environment reference");
  const password = reference[1];
  const output: Record<string, string> = {};
  for (const [field, name] of Object.entries({
    host: "HOST",
    port: "PORT",
    user: "USER",
    pass: "PASS",
    admin_email: "ADMIN_EMAIL",
    sender_name: "SENDER_NAME",
  })) {
    const value = smtp[field as keyof SmtpConfig];
    if (value === undefined) continue;
    const ref = /^env\(([A-Z_][A-Z0-9_]*)\)$/.exec(String(value));
    const rendered = ref ? `\${${ref[1]}:-}` : String(value);
    output[`GOTRUE_SMTP_${name}`] =
      field === "pass" || field === "port"
        ? rendered
        : `\${${password}:+${rendered}}`;
  }
  return output;
}

/** Logon reuses the existing stack; update only auth's SMTP references. */
export function refreshProductionSmtp(): void {
  const path = join(stackDir("prod"), "compose.json");
  const compose = JSON.parse(readFileSync(path, "utf8"));
  if (!compose.services?.auth?.environment)
    throw new Error("Missing production auth service");
  Object.assign(
    compose.services.auth.environment,
    smtpEnvironment(PRODUCTION_SMTP),
  );
  writeFileSync(path, JSON.stringify(compose, null, 2));
}
