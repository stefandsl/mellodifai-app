import { readFile } from "node:fs/promises";

export type Secrets = {
  values: Readonly<Record<string, string>>;
  redact(text: string): string;
};

export async function loadSecrets(
  environment: Record<string, string | undefined> = process.env,
): Promise<Secrets> {
  const values: Record<string, string> = {};
  for (const file of environment.WORKER_ENV_FILES?.split(";").filter(Boolean) ??
    []) {
    for (const rawLine of (await readFile(file, "utf8")).split(/\r?\n/u)) {
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
  }
  const protectedValues = [
    ...new Set(
      [
        ...Object.values(values),
        environment.SUPABASE_SERVICE_ROLE_KEY ?? "",
      ].filter((value) => value.length >= 8),
    ),
  ].sort((a, b) => b.length - a.length);
  for (const [key, value] of Object.entries(environment))
    if (value !== undefined && !(key in values)) values[key] = value;
  return {
    values,
    redact: (text) =>
      protectedValues.reduce(
        (result, value) => result.split(value).join("***"),
        text,
      ),
  };
}
