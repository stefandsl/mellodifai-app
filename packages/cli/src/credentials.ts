import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

export type Credentials = { url: string; pat: string };

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(
    env.APPDATA ?? join(homedir(), ".config"),
    "mellodifai",
    "credentials.json",
  );
}

export function validateCredentials(value: unknown): Credentials {
  if (
    !value ||
    typeof value !== "object" ||
    !("url" in value) ||
    !("pat" in value) ||
    typeof value.url !== "string" ||
    typeof value.pat !== "string"
  ) {
    throw new Error("Credenziali non valide. Esegui mellodifai login.");
  }
  const url = new URL(value.url);
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^mdf_[A-Za-z0-9_-]+$/.test(value.pat)
  ) {
    throw new Error(
      "Usa un'origine HTTPS (HTTP solo su loopback) e un PAT valido.",
    );
  }
  return { url: url.origin, pat: value.pat };
}

export async function loadCredentials(
  file = credentialPath(),
): Promise<Credentials> {
  try {
    return validateCredentials(JSON.parse(await readFile(file, "utf8")));
  } catch {
    throw new Error(
      "Credenziali assenti o non valide. Esegui mellodifai login.",
    );
  }
}

export async function saveCredentials(
  value: Credentials,
  file = credentialPath(),
): Promise<void> {
  const credentials = validateCredentials(value);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(credentials), {
      mode: 0o600,
      flag: "wx",
    });
    if (process.platform === "win32") {
      const username = process.env.USERNAME;
      if (!username) throw new Error("Missing username");
      await promisify(execFile)(
        "icacls",
        [temporary, "/inheritance:r", "/grant:r", `${username}:F`],
        { windowsHide: true },
      );
    } else {
      await chmod(temporary, 0o600);
    }
    // Restrict the new file before replacing an existing login.
    await rename(temporary, file);
  } catch {
    throw new Error("Impossibile salvare le credenziali con permessi privati.");
  } finally {
    await rm(temporary, { force: true });
  }
}
