import { envFromValues } from "@mellodifai/remake";
import { afterEach, expect, it, vi } from "vitest";
import type { StageContext } from "../src/loop.js";
import type { Ledger } from "../src/providers/ledger.js";
import {
  meteredOpenRouterFetch,
  openRouterCall,
  openRouterRequest,
  remakeProviderClient,
} from "../src/providers/openrouter.js";

afterEach(() => vi.unstubAllGlobals());

it("does not fall back to global fetch when a caller omits the ledger transport", () => {
  const http = vi.fn();
  vi.stubGlobal("fetch", http);
  expect(() =>
    openRouterRequest("chat", {}, { key: "test-only" } as Parameters<
      typeof openRouterRequest
    >[2]),
  ).toThrow("ledger transport");
  expect(http).not.toHaveBeenCalled();
});

it("the production factory uses ops RPCs before sending and after receiving", async () => {
  const events: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/v1/rpc/")) {
        const name = url.split("/").pop() as string;
        expect(new Headers(init?.headers).get("content-profile")).toBe("ops");
        events.push(name);
        return new Response(
          JSON.stringify(
            name === "reserve_job"
              ? "reservation"
              : name === "spend_entry_open"
                ? "entry"
                : null,
          ),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      events.push("provider");
      return new Response(
        JSON.stringify({
          usage: { cost: 0.001, prompt_tokens: 20, completion_tokens: 10 },
        }),
      );
    }),
  );
  const context = {
    job: { id: "job", stage: "lyrics_assist", attempts: 1 },
    secrets: {
      values: {
        SUPABASE_URL: "http://127.0.0.1:45621",
        SUPABASE_SERVICE_ROLE_KEY: "test-only-key",
        OPENROUTER_API_KEY: "test-provider-key",
      },
    },
    signal: new AbortController().signal,
  } as unknown as StageContext;
  await openRouterRequest(
    "chat",
    { model: "model", messages: [] },
    openRouterCall(context),
  );
  expect(events).toEqual([
    "reserve_job",
    "spend_entry_open",
    "provider",
    "settle_spend",
  ]);
});

it("preserves HTTP refusal status without settling uncertain spend", async () => {
  const db = ledger();
  const http = vi.fn(async () => new Response("refused", { status: 400 }));
  const fetch = meteredOpenRouterFetch(
    { id: "job", attempts: 1, stage: "remake_rewrite" },
    () => db,
    http,
  );
  expect(
    (await fetch("https://openrouter.ai/api/v1/chat/completions", request))
      .status,
  ).toBe(400);
  expect(db.open).toHaveBeenCalledTimes(1);
  expect(db.settle).not.toHaveBeenCalled();
});

function ledger(): Ledger {
  return {
    reservationFor: vi.fn(async () => "reservation"),
    open: vi.fn(async () => "entry"),
    extend: vi.fn(async () => {}),
    settle: vi.fn(async () => {}),
  };
}
const request = {
  method: "POST",
  body: JSON.stringify({ model: "model", messages: [], max_tokens: 1000 }),
};

it("the real remake client meters chat, decision and embedding requests", async () => {
  const db = ledger();
  const http = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
          answers: {},
          data: [{ index: 0, embedding: [1, 0] }],
          usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.001 },
        }),
      ),
  );
  vi.stubGlobal("fetch", http);
  const context = {
    job: { id: "job", stage: "remake_rewrite", attempts: 1 },
    secrets: { values: { OPENROUTER_API_KEY: "test-key" } },
    signal: new AbortController().signal,
    providerLedger: () => db,
  } as unknown as StageContext;
  const client = remakeProviderClient(
    envFromValues(context.secrets.values),
    context.signal,
    context,
  );
  await client.chat({
    step: "writer",
    model: "model",
    system: "system",
    user: "user",
  });
  await client.decide({ model: "model" }, "judge");
  await client.embed(["text"], "model");
  expect(http).toHaveBeenCalledTimes(3);
  expect(db.open).toHaveBeenCalledTimes(3);
  expect(db.settle).toHaveBeenCalledTimes(3);
});

it.each(["lyrics_assist", "remake_analyse", "remake_rewrite"])(
  "%s cannot send a request without a database reservation",
  async (stage) => {
    const db = ledger();
    vi.mocked(db.reservationFor).mockResolvedValue(null);
    const http = vi.fn();
    const fetch = meteredOpenRouterFetch(
      { id: "job", attempts: 1, stage },
      () => db,
      http,
    );
    await expect(
      fetch("https://openrouter.ai/api/v1/chat/completions", request),
    ).rejects.toThrow("no reservation");
    expect(http).not.toHaveBeenCalled();
    expect(db.open).not.toHaveBeenCalled();
  },
);

it("reserves, opens and settles each request, including client retries", async () => {
  const db = ledger();
  const http = vi.fn(async () => {
    expect(db.open).toHaveBeenCalled();
    return new Response(
      JSON.stringify({
        usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.002 },
        choices: [],
      }),
    );
  });
  const fetch = meteredOpenRouterFetch(
    { id: "job", attempts: 2, stage: "remake_rewrite" },
    () => db,
    http,
  );
  await fetch("https://openrouter.ai/api/v1/chat/completions", request);
  await fetch("https://openrouter.ai/api/v1/chat/completions", request);
  expect(db.open).toHaveBeenNthCalledWith(
    1,
    "openrouter:remake_rewrite:0:0:a2",
    expect.any(Object),
  );
  expect(db.open).toHaveBeenNthCalledWith(
    2,
    "openrouter:remake_rewrite:0:1:a2",
    expect.any(Object),
  );
  expect(db.settle).toHaveBeenCalledWith(
    "entry",
    { mtok_in: 0.0001, mtok_out: 0.00002 },
    0.002,
  );
  expect(db.settle).toHaveBeenCalledTimes(2);
});

it("a refused extension never sends the request", async () => {
  const db = ledger();
  vi.mocked(db.open).mockRejectedValue({ code: "MDF07" });
  vi.mocked(db.extend).mockRejectedValue({ code: "MDF02" });
  const http = vi.fn();
  const fetch = meteredOpenRouterFetch(
    { id: "job", attempts: 1, stage: "lyrics_assist" },
    () => db,
    http,
  );
  await expect(
    fetch("https://openrouter.ai/api/v1/chat/completions", request),
  ).rejects.toMatchObject({ code: "MDF02" });
  expect(http).not.toHaveBeenCalled();
});
