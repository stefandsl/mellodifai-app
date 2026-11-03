import { type Items, isCapRefusal, type Ledger } from "./ledger.js";

// Checked 2026-11-03 against https://kie.ai/pricing.html and the Kie common API docs:
// prices attach to model generation, while balance, status, upload and result retrieval are utility calls.
export const FREE_KEY_CALLS = [
  "kie:credit",
  "kie:job",
  "kie:record-info",
  "kie:wait",
  "kie:lyrics-ts",
  "kie:upload",
  "kie:download",
  "kie:balance-refresh",
] as const;

export const OPENROUTER_BASE =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api";
export const OPENROUTER_CHAT_URL = `${OPENROUTER_BASE}/v1/chat/completions`;
export const OPENROUTER_DECISIONS_URL = `${OPENROUTER_BASE}/alpha/decisions`;

export function openRouterKey(
  secrets: Readonly<Record<string, string | undefined>>,
): string {
  return secrets.LYRICS_OPENROUTER_KEY ?? secrets.OPENROUTER_API_KEY ?? "";
}

export function openRouterKeyFromEnv(env: {
  get(name: string): string | undefined;
  require(name: string): string;
}): string {
  return env.get("LYRICS_OPENROUTER_KEY") ?? env.require("OPENROUTER_API_KEY");
}

export function groqAvailable(
  secrets: Readonly<Record<string, string | undefined>>,
): boolean {
  return Boolean(secrets.GROQ_API_KEY);
}

export function callKey(
  kind: "kie" | "openrouter" | "groq",
  parts: {
    op?: string;
    role?: string;
    round?: number;
    n?: number;
    takeId?: string;
    attempt: number;
  },
): string {
  if (!Number.isInteger(parts.attempt) || parts.attempt < 1)
    throw new Error("invalid job attempt");
  if (kind === "kie") {
    if (!parts.op) throw new Error("kie call needs an operation");
    return `kie:${parts.op}:${parts.attempt}`;
  }
  if (kind === "openrouter") {
    if (!parts.role || parts.round === undefined || parts.n === undefined)
      throw new Error("openrouter call needs role, round and n");
    return `openrouter:${parts.role}:${parts.round}:${parts.n}:a${parts.attempt}`;
  }
  if (!parts.takeId) throw new Error("groq call needs a take id");
  return `groq:${parts.takeId}:a${parts.attempt}`;
}

export async function paidCall<T>(
  ledger: Ledger,
  key: string,
  est: Items,
  run: () => Promise<{ result: T; items: Items; usd?: number }>,
): Promise<T> {
  const entry = await openPaidEntry(ledger, key, est);
  const { result, items, usd } = await run();
  await ledger.settle(entry, items, usd);
  return result;
}

export async function openPaidEntry(
  ledger: Ledger,
  key: string,
  est: Items,
): Promise<string> {
  try {
    return await ledger.open(key, est);
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "MDF07") throw error;
    try {
      await ledger.extend(est);
    } catch (refusal) {
      if (isCapRefusal(refusal))
        throw new Error("cap_exceeded", { cause: refusal });
      throw refusal;
    }
    return ledger.open(key, est);
  }
}

export async function freeCall<T>(
  key: (typeof FREE_KEY_CALLS)[number],
  run: () => Promise<T>,
): Promise<T> {
  if (!(FREE_KEY_CALLS as readonly string[]).includes(key))
    throw new Error("unknown free call");
  return run();
}
