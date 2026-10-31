import { readFile } from "node:fs/promises";

export type Secrets = {
  values: Readonly<Record<string, string>>;
  secretNames?: readonly string[];
  redact(text: string): string;
};

const credentialName =
  /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|COOKIE)/iu;

// File-loaded names are private even when their names do not resemble credentials.
// Drop exact value aliases only; short values must not erase system paths.
export function childEnvironment(
  environment: NodeJS.ProcessEnv,
  secrets?: Secrets,
): NodeJS.ProcessEnv {
  const names = new Set(
    (secrets?.secretNames ?? []).map((name) => name.toUpperCase()),
  );
  for (const name of Object.keys(secrets?.values ?? {}))
    if (credentialName.test(name)) names.add(name.toUpperCase());
  const values = [
    ...Object.entries(secrets?.values ?? {}),
    ...Object.entries(environment),
  ]
    .filter(
      ([name, value]) =>
        names.has(name.toUpperCase()) && (value?.length ?? 0) >= 8,
    )
    .map(([, value]) => value as string);
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) =>
        !names.has(name.toUpperCase()) &&
        !values.some((secret) => value === secret),
    ),
  );
}

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
  const secretNames = [
    ...new Set([
      ...Object.keys(values),
      ...Object.keys(environment).filter((name) => credentialName.test(name)),
    ]),
  ];
  const protectedValues = [
    ...new Set(
      [
        ...Object.values(values),
        ...secretNames.map((name) => environment[name] ?? ""),
      ].filter((value) => value.length >= 8),
    ),
  ].sort((a, b) => b.length - a.length);
  for (const [key, value] of Object.entries(environment))
    if (value !== undefined && !(key in values)) values[key] = value;
  return {
    values,
    secretNames,
    redact: (text) =>
      protectedValues.reduce(
        (result, value) => result.split(value).join("***"),
        text,
      ),
  };
}
