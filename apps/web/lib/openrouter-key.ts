const NAMES = ["LYRICS_OPENROUTER_KEY", "OPENROUTER_API_KEY"] as const;

type Env = Record<string, string | undefined>;

// Next reads only its own environment; provider keys never reach the browser.
export async function openRouterKey(
  env: Env = process.env,
): Promise<string | null> {
  for (const name of NAMES) if (env[name]) return env[name] ?? null;
  return null;
}

export async function groqKey(env: Env = process.env): Promise<string | null> {
  return env.GROQ_API_KEY || null;
}
