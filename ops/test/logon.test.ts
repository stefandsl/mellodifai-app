import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { realRunner } from "../lib/run.js";
import { SMTP_SETUP_NOTICE } from "../lib/smtp.js";
import { testTempBase } from "./temp-base.js";

it.skipIf(process.platform !== "win32")(
  "native logon never consults Docker",
  async () => {
    const root = mkdtempSync(join(testTempBase(), "native-logon-test-"));
    try {
      const fake = join(root, "pnpm.ps1");
      writeFileSync(fake, "$global:LASTEXITCODE=0\n");
      const script = fileURLToPath(new URL("../logon.ps1", import.meta.url));
      const result = await realRunner(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `function global:docker { throw 'Docker must never be called' }; function global:Invoke-RestMethod { @{web='ok';db='ok';ops='ok';worker_heartbeat_age_s=1} }; & '${script}' -Root '${root}' -Pnpm '${fake}' -Attempts 1 -RetrySeconds 0`,
        ],
        { env: { TEMP: root, TMP: root, MELLODIFAI_RUNTIME: "native" } },
      );
      expect(result.code).toBe(0);
      expect(readFileSync(join(root, "logs/logon.log"), "utf8")).toContain(
        "Production ready",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "win32")(
  "logon waits for Docker and a fresh heartbeat, suppressing raw child output",
  async () => {
    const root = mkdtempSync(join(testTempBase(), "logon-test-"));
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    try {
      const fakePnpm = join(root, "pnpm.ps1");
      writeFileSync(
        fakePnpm,
        `if ($args[-2] -ne 'run' -or $args[-1] -ne 'start:production') { exit 9 }; 'private child output'; '${SMTP_SETUP_NOTICE}'; $global:LASTEXITCODE=0\n`,
      );
      const script = fileURLToPath(new URL("../logon.ps1", import.meta.url));
      const result = await realRunner(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$global:dockerCalls=0; $global:healthCalls=0; function global:docker { $global:dockerCalls++; if ($global:dockerCalls -eq 1) { $global:LASTEXITCODE=1 } else { $global:LASTEXITCODE=0 } }; function global:Invoke-RestMethod { $global:healthCalls++; @{web='ok';db='ok';ops='ok';worker_heartbeat_age_s=$(if ($global:healthCalls -eq 1) { 120 } else { 2 })} }; & ${quote(script)} -Root ${quote(root)} -Pnpm ${quote(fakePnpm)} -Attempts 3 -RetrySeconds 0`,
        ],
        { env: { TEMP: root, TMP: root, MELLODIFAI_RUNTIME: "docker" } },
      );
      expect(result.code, result.stderr).toBe(0);
      const log = readFileSync(join(root, "logs/logon.log"), "utf8");
      expect(log).toContain("Attempt 1: Docker not ready");
      expect(log).toContain("Attempt 2: services exit 0; health not ready");
      expect(log).toContain(
        "Production ready: web/db/ops ok; worker heartbeat fresh",
      );
      expect(log).not.toContain("private");
      expect(log.split(SMTP_SETUP_NOTICE)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "win32")(
  "logon fails closed when Docker never becomes ready",
  async () => {
    const root = mkdtempSync(join(testTempBase(), "logon-timeout-"));
    try {
      const script = fileURLToPath(new URL("../logon.ps1", import.meta.url));
      const result = await realRunner(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `function global:docker { $global:LASTEXITCODE=1 }; & '${script}' -Root '${root}' -Pnpm 'must-not-be-called' -Attempts 1 -RetrySeconds 0`,
        ],
        { env: { TEMP: root, TMP: root, MELLODIFAI_RUNTIME: "docker" } },
      );
      expect(result.code).toBe(1);
      expect(readFileSync(join(root, "logs/logon.log"), "utf8")).toContain(
        "Recovery timed out",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
