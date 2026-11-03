"use server";
import { execFile } from "node:child_process";

import { requireProfile } from "@/lib/auth";

export type BackupResult =
  | { ok: true; dir: string }
  | { ok: false; error: string };

// Only the local launcher sets MELLODIFAI_LAUNCHER, so a hosted deploy never runs this.
export async function backupAvailable() {
  return Boolean(process.env.MELLODIFAI_LAUNCHER);
}

export async function exportBackup(): Promise<BackupResult> {
  const { profile } = await requireProfile();
  if (profile.role !== "admin")
    return {
      ok: false,
      error: "Solo l'amministratore puo' esportare il backup.",
    };
  const launcher = process.env.MELLODIFAI_LAUNCHER;
  if (!launcher)
    return {
      ok: false,
      error: "Il backup si esporta solo dall'app avviata sul PC.",
    };
  return new Promise((done) => {
    execFile(
      process.execPath,
      [launcher, "backup", "--json"],
      { timeout: 1_800_000, windowsHide: true },
      (_error, stdout) => {
        const line = stdout.trim().split(/\r?\n/u).pop() ?? "";
        try {
          done(JSON.parse(line) as BackupResult);
        } catch {
          done({ ok: false, error: "Backup non riuscito." });
        }
      },
    );
  });
}
