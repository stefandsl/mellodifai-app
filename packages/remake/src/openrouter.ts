// OpenRouter calls with a cost ledger and a hard stop on the account's privacy filter.
// The filter can replace ordinary words with tags such as [PERSON_NAME] before a model
// sees them (seen live 2026-11-01, see apps/worker/src/stages/lyric-jury.ts); lyrics
// written from a corrupted source would be wrong, so any tag in a reply is fatal.
import type { RemakeCost } from "@mellodifai/shared";

const BASE = "https://openrouter.ai/api";
export const JEV = "typesafe/jev-1.14";

// Model routing (task 27 cost rule: analysis plus one rewrite round under 0.05 USD): the cheap
// model writes drafts and targeted line fixes; the strong model only writes the final pass and
// argues as the devil's advocate (design 10.2). Every id is configurable (modelsFromEnv).
export const DEFAULT_MODELS = {
  draft: "anthropic/claude-haiku-5.5",
  fixer: "anthropic/claude-haiku-5.5",
  final: "anthropic/claude-sonnet-5.5",
  analyst: "anthropic/claude-haiku-5.5",
  vision: "google/gemini-3.8-flash",
  judges: [JEV, "anthropic/claude-haiku-5.5", "google/gemini-3.8-flash"],
  devil: "anthropic/claude-sonnet-5.5",
  // Fallback only (--embedder openrouter); the gate uses local LaBSE (design 10.3).
  embedding: "baai/bge-m3",
};
export type Models = typeof DEFAULT_MODELS;

// REMAKE_MODEL_DRAFT, _FIX, _FINAL, _ANALYST, _VISION, _DEVIL, _EMBEDDING and REMAKE_JUDGES
// (comma list) override the defaults; unset names keep them.
export function modelsFromEnv(
  get: (name: string) => string | undefined,
): Models {
  const pick = (name: string, fallback: string) =>
    get(name)?.trim() || fallback;
  const judges = get("REMAKE_JUDGES")
    ?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    draft: pick("REMAKE_MODEL_DRAFT", DEFAULT_MODELS.draft),
    fixer: pick("REMAKE_MODEL_FIX", DEFAULT_MODELS.fixer),
    final: pick("REMAKE_MODEL_FINAL", DEFAULT_MODELS.final),
    analyst: pick("REMAKE_MODEL_ANALYST", DEFAULT_MODELS.analyst),
    vision: pick("REMAKE_MODEL_VISION", DEFAULT_MODELS.vision),
    judges: judges?.length ? judges : DEFAULT_MODELS.judges,
    devil: pick("REMAKE_MODEL_DEVIL", DEFAULT_MODELS.devil),
    embedding: pick("REMAKE_MODEL_EMBEDDING", DEFAULT_MODELS.embedding),
  };
}

export type Reasoning =
  | { effort: "low" | "medium" | "high" }
  | { enabled: false };

// Hidden reasoning is billed as output and counts against max_tokens. Haiku 5.5 ignores the
// effort and spent every token of a 3000 or 4000 token budget thinking (task 27 probe, 02/11:
// finish "length", empty reply, 0.0018 USD each), so the cheap model runs with reasoning off;
// the others keep a low effort.
const REASONING_OFF = [/claude-haiku/iu];
export function defaultReasoning(model: string): Reasoning {
  return REASONING_OFF.some((pattern) => pattern.test(model))
    ? { enabled: false }
    : { effort: "low" };
}

// USD per step group (write, fix-lines, final-pass, jury, devil, ...), for the logs.
export function costByStep(cost: RemakeCost): Record<string, number> {
  const out: Record<string, number> = {};
  for (const call of cost.calls) {
    const group = call.step.startsWith("jury:devil")
      ? "devil"
      : call.step.startsWith("jury:")
        ? "jury"
        : call.step;
    out[group] = Math.round(((out[group] ?? 0) + call.usd) * 1e6) / 1e6;
  }
  return out;
}

export function costLine(cost: RemakeCost): string {
  const parts = Object.entries(costByStep(cost))
    .sort((a, b) => b[1] - a[1])
    .map(([step, usd]) => `${step} ${usd.toFixed(4)}`);
  return `${cost.usd.toFixed(4)} USD (${parts.join(", ") || "no calls"})`;
}

// USD per million tokens, used only when a reply carries no `usage.cost`.
const PRICES: Record<string, [number, number]> = {
  "anthropic/claude-opus-5.5": [4, 20],
  "anthropic/claude-sonnet-5.5": [2, 10],
  "anthropic/claude-haiku-5.5": [0.1, 0.5],
  "google/gemini-3.8-flash": [0.825, 4.125],
  "baai/bge-m3": [0.01, 0],
};

const REDACTED =
  /\[(?:PERSON_NAME|ADDRESS|EMAIL(?:_ADDRESS)?|PHONE(?:_NUMBER)?|LOCATION|ORGANIZATION|DATE_TIME|URL|IP_ADDRESS)\]/u;

export class RedactionError extends Error {
  constructor(step: string, sample: string) {
    super(
      `OpenRouter's privacy filter replaced words with tags such as [PERSON_NAME] during "${step}" (${sample}). ` +
        "Refusing to continue with corrupted lyrics: turn the filter off in OpenRouter settings (Privacy) or route these calls elsewhere.",
    );
    this.name = "RedactionError";
  }
}

export function assertNotRedacted(text: string, step: string): void {
  const match = REDACTED.exec(text);
  if (match) {
    const at = Math.max(0, match.index - 40);
    throw new RedactionError(
      step,
      text.slice(at, match.index + 40).replace(/\s+/gu, " "),
    );
  }
}

export class Ledger {
  readonly calls: RemakeCost["calls"] = [];
  add(call: RemakeCost["calls"][number]): void {
    this.calls.push(call);
  }
  get usd(): number {
    return (
      Math.round(this.calls.reduce((sum, c) => sum + c.usd, 0) * 1e6) / 1e6
    );
  }
  since(mark: number): RemakeCost {
    const calls = this.calls.slice(mark);
    return {
      usd: Math.round(calls.reduce((sum, c) => sum + c.usd, 0) * 1e6) / 1e6,
      calls,
    };
  }
  toJSON(): RemakeCost {
    return { usd: this.usd, calls: this.calls };
  }
}

type Fetch = typeof globalThis.fetch;
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatRequest = {
  step: string;
  model: string;
  system: string;
  user: string | ContentPart[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  // Reasoning cannot be disabled on these models; low effort keeps the hidden, output-billed tokens small.
  reasoning?: Reasoning;
};

export type Client = {
  ledger: Ledger;
  chat(request: ChatRequest): Promise<string>;
  chatJson<T = Record<string, unknown>>(request: ChatRequest): Promise<T>;
  embed(texts: string[], model: string, step?: string): Promise<number[][]>;
  decide(body: Record<string, unknown>, step: string): Promise<unknown>;
};

export function parseJsonReply(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models wrap the object in prose: take the outermost braces.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start)
      return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("reply is not JSON");
  }
}

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
};

export function createClient(options: {
  key: string;
  fetchFn?: Fetch;
  ledger?: Ledger;
  timeoutMs?: number;
  retries?: number;
  // A cancelled job stops its requests (and their retries).
  signal?: AbortSignal;
}): Client {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const ledger = options.ledger ?? new Ledger();
  const retries = options.retries ?? 2;

  async function post(
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetchFn(`${BASE}${path}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.key}`,
            "Content-Type": "application/json",
            "X-Title": "mellodifai remake",
          },
          body: JSON.stringify(body),
          signal: options.signal
            ? AbortSignal.any([
                options.signal,
                AbortSignal.timeout(options.timeoutMs ?? timeoutMs),
              ])
            : AbortSignal.timeout(options.timeoutMs ?? timeoutMs),
        });
        if (response.ok) return await response.json();
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        lastError = new Error(
          `OpenRouter ${response.status} on ${path}: ${detail}`,
        );
        if (response.status !== 429 && response.status < 500) break;
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) break;
      }
      if (attempt < retries)
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  function record(step: string, model: string, usage: Usage | undefined) {
    const promptTokens = Math.max(0, Math.round(usage?.prompt_tokens ?? 0));
    const completionTokens = Math.max(
      0,
      Math.round(usage?.completion_tokens ?? 0),
    );
    const price = PRICES[model];
    const estimatedUsd = price
      ? (promptTokens * price[0] + completionTokens * price[1]) / 1e6
      : 0;
    const known =
      typeof usage?.cost === "number" && Number.isFinite(usage.cost);
    ledger.add({
      step,
      model,
      usd: Math.max(0, known ? (usage?.cost ?? 0) : estimatedUsd),
      promptTokens,
      completionTokens,
      estimated: !known,
    });
  }

  async function chat(request: ChatRequest): Promise<string> {
    const json = (await post(
      "/v1/chat/completions",
      {
        model: request.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        ...(request.json ? { response_format: { type: "json_object" } } : {}),
        max_tokens: request.maxTokens ?? 2000,
        temperature: request.temperature ?? 0.7,
        // These endpoints always reason, and hidden reasoning counts against max_tokens
        // (seen live: Sonnet 5.5 spent all 3000 tokens thinking and returned nothing).
        reasoning: request.reasoning ?? defaultReasoning(request.model),
        usage: { include: true },
      },
      90_000,
    )) as {
      choices?: { finish_reason?: string; message?: { content?: string } }[];
      usage?: Usage;
    };
    record(request.step, request.model, json.usage);
    // Owner rule: no em or en dash characters anywhere in what the engine writes.
    const content = (json.choices?.[0]?.message?.content ?? "").replace(
      new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`, "gu"),
      "-",
    );
    if (!content.trim())
      throw new Error(
        `${request.model} returned an empty reply (${request.step})`,
      );
    assertNotRedacted(content, request.step);
    const finish = json.choices?.[0]?.finish_reason;
    if (finish && finish !== "stop" && finish !== "end_turn")
      throw new Error(
        `${request.model} stopped early (${finish}) in "${request.step}" after ${content.length} characters`,
      );
    return content;
  }

  return {
    ledger,
    chat,
    async chatJson<T>(request: ChatRequest): Promise<T> {
      const content = await chat({ ...request, json: true });
      try {
        return parseJsonReply(content) as T;
      } catch {
        // One retry with a reminder; a second failure is the caller's error.
        const again = await chat({
          ...request,
          json: true,
          system: `${request.system}\nReply with one valid JSON object only, no prose.`,
        });
        try {
          return parseJsonReply(again) as T;
        } catch (error) {
          const at = Number(/position (\d+)/u.exec(String(error))?.[1] ?? 0);
          throw new Error(
            `${request.model} returned invalid JSON twice in "${request.step}" (${String(error)}; near: ${JSON.stringify(again.slice(Math.max(0, at - 120), at + 60))}; ${again.length} chars)`,
          );
        }
      }
    },
    async embed(texts, model, step = "embeddings") {
      const json = (await post(
        "/v1/embeddings",
        { model, input: texts },
        60_000,
      )) as {
        data?: { index?: number; embedding?: number[] }[];
        usage?: Usage;
      };
      record(step, model, json.usage);
      const rows = [...(json.data ?? [])].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0),
      );
      if (rows.length !== texts.length)
        throw new Error("embedding count mismatch");
      return rows.map((r) => r.embedding ?? []);
    },
    async decide(body, step) {
      const json = (await post("/alpha/decisions", body, 20_000)) as {
        usage?: Usage;
      };
      record(step, String(body.model ?? JEV), json.usage);
      assertNotRedacted(JSON.stringify(json), step);
      return json;
    },
  };
}
