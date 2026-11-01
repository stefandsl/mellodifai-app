import { readFile } from "node:fs/promises";

const NAMES = ["LYRICS_OPENROUTER_KEY", "OPENROUTER_API_KEY"] as const;

// The OpenRouter key, read on the server only: from the environment, else from the same env
// files the worker loads (WORKER_ENV_FILES, ";"-separated), so one key serves both. The lyric
// pipeline's own key wins over the general one, as in the worker. Never log or return the value.
export async function openRouterKey(
  env: Record<string, string | undefined> = process.env,
  read: (file: string) => Promise<string> = (file) => readFile(file, "utf8"),
): Promise<string | null> {
  for (const name of NAMES) if (env[name]) return env[name] ?? null;
  const found: Partial<Record<(typeof NAMES)[number], string>> = {};
  for (const file of env.WORKER_ENV_FILES?.split(";").filter(Boolean) ?? []) {
    let text: string;
    try {
      text = await read(file);
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/u)) {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(
        line.trim(),
      );
      const name = NAMES.find((candidate) => candidate === match?.[1]);
      if (!name || match?.[2] === undefined) continue;
      const raw = match[2].trim();
      const value = /^(".*"|'.*')$/u.test(raw) ? raw.slice(1, -1) : raw;
      if (value) found[name] = value;
    }
  }
  return found.LYRICS_OPENROUTER_KEY ?? found.OPENROUTER_API_KEY ?? null;
}
