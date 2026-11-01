import { readFile } from "node:fs/promises";

const NAMES = ["LYRICS_OPENROUTER_KEY", "OPENROUTER_API_KEY"] as const;

type Env = Record<string, string | undefined>;
type Read = (file: string) => Promise<string>;
const readText: Read = (file) => readFile(file, "utf8");

// The OpenRouter key, read on the server only: from the environment, else from the same env
// files the worker loads (WORKER_ENV_FILES, ";"-separated), so one key serves both. The lyric
// pipeline's own key wins over the general one, as in the worker. Never log or return the value.
export async function openRouterKey(
  env: Env = process.env,
  read: Read = readText,
): Promise<string | null> {
  return serverKey(NAMES, env, read);
}

// The Groq key the worker's transcriptions use (Whisper), found the same way.
export async function groqKey(
  env: Env = process.env,
  read: Read = readText,
): Promise<string | null> {
  return serverKey(["GROQ_API_KEY"], env, read);
}

// The first of `names` that has a value, in order of preference.
async function serverKey(
  names: readonly string[],
  env: Env,
  read: Read,
): Promise<string | null> {
  for (const name of names) if (env[name]) return env[name] ?? null;
  const found: Partial<Record<string, string>> = {};
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
      const name = names.find((candidate) => candidate === match?.[1]);
      if (!name || match?.[2] === undefined) continue;
      const raw = match[2].trim();
      const value = /^(".*"|'.*')$/u.test(raw) ? raw.slice(1, -1) : raw;
      if (value) found[name] = value;
    }
  }
  for (const name of names) if (found[name]) return found[name] ?? null;
  return null;
}
