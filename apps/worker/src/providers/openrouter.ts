import { type Env, createClient as remakeClient } from "@mellodifai/remake";
import { createClient } from "@supabase/supabase-js";
import type { StageContext } from "../loop.js";
import { type Ledger, serviceLedger } from "./ledger.js";
import {
  callKey,
  OPENROUTER_CHAT_URL,
  OPENROUTER_DECISIONS_URL,
  openRouterKey,
  openRouterKeyFromEnv,
  paidCall,
} from "./paid.js";

export type LedgerForModel = (model: string) => Ledger;
type Job = { id: string; stage: string; attempts?: number };
export type OpenRouterCall = {
  key: string;
  signal?: AbortSignal;
  fetchFn: typeof fetch;
};

// Every HTTP attempt, including the remake client's retries, gets its own database entry.
export function meteredOpenRouterFetch(
  job: Job,
  ledgerFor: LedgerForModel,
  http: typeof fetch = globalThis.fetch,
): typeof fetch {
  let n = 0;
  return async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      max_tokens?: number;
    };
    if (!body.model) throw new Error("OpenRouter request has no model");
    const key = callKey("openrouter", {
      role: job.stage,
      round: 0,
      n: n++,
      attempt: job.attempts ?? 1,
    });
    const ledger = ledgerFor(body.model);
    if (!(await ledger.reservationFor(job.id)))
      throw new Error("paid call has no reservation");
    // One input token per UTF-8 byte is conservative; never assume missing usage is free.
    const est = {
      mtok_in: Math.max(8000, Buffer.byteLength(String(init?.body))) / 1e6,
      mtok_out: (body.max_tokens ?? 4096) / 1e6,
    };
    if ((job.attempts ?? 1) > 1) await ledger.extend(est);
    let refused: Response | undefined;
    try {
      return await paidCall(ledger, key, est, async () => {
        const response = await http(url, init);
        if (!response.ok) {
          refused = response;
          throw new Error(`OpenRouter request failed: ${response.status}`);
        }
        const json = (await response.clone().json()) as {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            cost?: number;
          };
        };
        const usage = json.usage;
        return {
          result: response,
          items: {
            mtok_in:
              usage?.prompt_tokens === undefined
                ? est.mtok_in
                : usage.prompt_tokens / 1e6,
            mtok_out:
              usage?.completion_tokens === undefined
                ? est.mtok_out
                : usage.completion_tokens / 1e6,
          },
          ...(usage?.cost === undefined ? {} : { usd: usage.cost }),
        };
      });
    } catch (error) {
      // Preserve the client's status-based retry policy; the uncertain entry stays open.
      if (refused) return refused;
      throw error;
    }
  };
}

type Context = Pick<
  StageContext,
  "job" | "secrets" | "signal" | "providerLedger"
>;
export function openRouterCall(context: Context): OpenRouterCall {
  const key = openRouterKey(context.secrets.values);
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  let ledgerFor = context.providerLedger;
  if (!ledgerFor) {
    const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey } =
      context.secrets.values;
    if (!url || !serviceKey)
      throw new Error("database ledger is not configured");
    const service = createClient(url, serviceKey);
    ledgerFor = (model) => serviceLedger(service, null, "openrouter", model);
  }
  return {
    key,
    signal: context.signal,
    fetchFn: meteredOpenRouterFetch(context.job, ledgerFor),
  };
}

export function openRouterRequest(
  kind: "chat" | "decisions",
  body: unknown,
  call: OpenRouterCall,
  timeoutMs = 90_000,
): Promise<Response> {
  if (!call.fetchFn) throw new Error("OpenRouter requires a ledger transport");
  const timeout = AbortSignal.timeout(timeoutMs);
  return call.fetchFn(
    kind === "chat" ? OPENROUTER_CHAT_URL : OPENROUTER_DECISIONS_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${call.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: call.signal ? AbortSignal.any([call.signal, timeout]) : timeout,
    },
  );
}

export async function openRouterPost(
  kind: "chat" | "decisions",
  body: unknown,
  call: OpenRouterCall,
  timeoutMs: number,
): Promise<unknown> {
  const response = await openRouterRequest(kind, body, call, timeoutMs);
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  return response.json();
}

export function remakeProviderClient(
  env: Env,
  signal: AbortSignal,
  context: Context,
) {
  const call = openRouterCall(context);
  return remakeClient({
    key: openRouterKeyFromEnv(env),
    signal,
    fetchFn: call.fetchFn,
  });
}
