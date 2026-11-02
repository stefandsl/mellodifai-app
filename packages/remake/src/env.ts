// Runtime keys, read the way apps/worker reads them (secrets.ts): a ";"-separated list
// of KEY=VALUE files, file values first, the process environment for the rest.
// Values are never printed: `redact` masks every loaded value in a message.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export const DEFAULT_ENV_FILES = [
  "C:/Users/Asus/Documents/Claude/Projects/ita/.env",
  "C:/Users/Asus/Documents/suno-remake/publish/.env",
  "C:/Users/Asus/Documents/mellodifai/apps/worker/.env.local",
];

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

export async function loadEnv(
  environment: Record<string, string | undefined> = process.env,
): Promise<Env> {
  const list = environment.REMAKE_ENV_FILES ?? environment.WORKER_ENV_FILES;
  const files = (list ? list.split(";") : DEFAULT_ENV_FILES).filter(
    (file) => file && existsSync(file),
  );
  const values: Record<string, string> = {};
  for (const file of files)
    for (const [name, value] of Object.entries(
      parseEnvFile(await readFile(file, "utf8")),
    ))
      if (value && !(name in values)) values[name] = value;
  const secrets = [...new Set(Object.values(values))]
    .filter((v) => v.length >= 8)
    .sort((a, b) => b.length - a.length);
  const get = (name: string) => values[name] ?? environment[name] ?? undefined;
  return {
    files,
    get,
    require(name) {
      const value = get(name);
      if (!value)
        throw new Error(
          `${name} is not set (looked in ${files.length} env files and the environment)`,
        );
      return value;
    },
    redact: (text) =>
      secrets.reduce((out, secret) => out.split(secret).join("***"), text),
  };
}
