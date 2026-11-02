// Runtime keys, read exactly the way apps/worker reads them (secrets.ts): WORKER_ENV_FILES is a
// ";"-separated list of KEY=VALUE files, file values first, the process environment for the
// rest. There are no built-in paths: a listed file that does not exist and a key nobody set
// both fail loudly. Values are never printed: `redact` masks every loaded value in a message.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export type Env = {
  get(name: string): string | undefined;
  require(name: string): string;
  redact(text: string): string;
  files: string[];
};

export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(
      rawLine.trim(),
    );
    if (match?.[1] && match[2] !== undefined) {
      const value = match[2].trim();
      values[match[1]] = /^(".*"|'.*')$/u.test(value)
        ? value.slice(1, -1)
        : value;
    }
  }
  return values;
}

// An Env over values someone else loaded (the worker passes its own secrets).
export function envFromValues(
  values: Readonly<Record<string, string | undefined>>,
  options: { redact?: (text: string) => string; files?: string[] } = {},
): Env {
  const get = (name: string) => values[name] || undefined;
  const secrets = [
    ...new Set(Object.values(values).filter((v): v is string => !!v)),
  ]
    .filter((v) => v.length >= 8)
    .sort((a, b) => b.length - a.length);
  const where = options.files?.length
    ? `${options.files.length} env files from WORKER_ENV_FILES and the environment`
    : "the worker's environment";
  return {
    files: options.files ?? [],
    get,
    require(name) {
      const value = get(name);
      if (!value)
        throw new Error(
          `${name} is not set (looked in ${where}); add it to one of the WORKER_ENV_FILES`,
        );
      return value;
    },
    redact:
      options.redact ??
      ((text) =>
        secrets.reduce((out, secret) => out.split(secret).join("***"), text)),
  };
}

export async function loadEnv(
  environment: Record<string, string | undefined> = process.env,
): Promise<Env> {
  const files = (environment.WORKER_ENV_FILES ?? "")
    .split(";")
    .map((file) => file.trim())
    .filter(Boolean);
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length)
    throw new Error(
      `WORKER_ENV_FILES lists ${missing.length} file(s) that do not exist: ${missing.join("; ")}`,
    );
  const values: Record<string, string> = {};
  for (const file of files)
    for (const [name, value] of Object.entries(
      parseEnvFile(await readFile(file, "utf8")),
    ))
      if (value && !(name in values)) values[name] = value;
  // The environment fills only what the files left unset; its values are redacted too
  // when their names look like credentials.
  const credential = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/iu;
  const merged: Record<string, string | undefined> = { ...values };
  for (const [name, value] of Object.entries(environment))
    if (value && !(name in merged)) merged[name] = value;
  const secretValues = [
    ...new Set([
      ...Object.values(values),
      ...Object.entries(environment)
        .filter(([name, value]) => value && credential.test(name))
        .map(([, value]) => value as string),
    ]),
  ]
    .filter((v) => v.length >= 8)
    .sort((a, b) => b.length - a.length);
  return envFromValues(merged, {
    files,
    redact: (text) =>
      secretValues.reduce((out, secret) => out.split(secret).join("***"), text),
  });
}
