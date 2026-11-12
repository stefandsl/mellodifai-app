// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  rate: vi.fn((): { ok: boolean; retryAfter?: number } => ({ ok: true })),
  key: vi.fn(async (): Promise<string | null> => "sk-test-key-123456"),
  user: { id: "u1" } as { id: string },
  signedIn: true,
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/ops/context", () => ({
  sessionCtx: async () => {
    if (!mocks.signedIn) throw new Error("Unauthorized");
    return { actor_kind: "session", user_id: mocks.user.id };
  },
}));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mocks.check }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rate }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/openrouter-key", () => ({ openRouterKey: mocks.key }));

import { formatStyle } from "./format-style";

it("refuses a remote action before reading the paid provider key", async () => {
  mocks.headers.mockResolvedValueOnce(new Headers({ "x-mdf-remote": "1" }));
  expect(await formatStyle({ styles: "jazz" })).toEqual({
    ok: false,
    error: "failed",
  });
  expect(mocks.key).not.toHaveBeenCalled();
});

const reply = (content: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status },
  );
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockResolvedValue({ ok: true, data: {} });
  mocks.signedIn = true;
  mocks.user = { id: `u${Math.random()}` };
  mocks.key.mockResolvedValue("sk-test-key-123456");
  fetchMock = vi.fn(async () =>
    reply({
      style: "synthwave, retro",
      bpm: 110,
      key: "A minor",
      timeSignature: "4/4",
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

it("sends the styles to OpenRouter with the server's key and returns the formatted result", async () => {
  const result = await formatStyle({ styles: "  retro synth  " });
  expect(result).toEqual({
    ok: true,
    styles: "synthwave, retro",
    bpm: 110,
    keyscale: "A minor",
    timeSignature: "4",
  });
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect((init.headers as Record<string, string>).Authorization).toBe(
    "Bearer sk-test-key-123456",
  );
  const body = JSON.parse(String(init.body)) as {
    model: string;
    messages: { content: string }[];
  };
  expect(body.model).toBe("anthropic/claude-sonnet-5.5");
  expect(body.messages[1]?.content).toBe("retro synth");
});

it("never puts the key in what it returns", async () => {
  const result = await formatStyle({ styles: "pop" });
  expect(JSON.stringify(result)).not.toContain("sk-test");
});

it("says so when no key is configured, without calling OpenRouter", async () => {
  mocks.key.mockResolvedValue(null);
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "noKey",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refuses empty or oversized styles and signed-out callers before any request", async () => {
  expect(await formatStyle({ styles: "   " })).toEqual({
    ok: false,
    error: "failed",
  });
  expect(await formatStyle({ styles: "x".repeat(1001) })).toEqual({
    ok: false,
    error: "failed",
  });
  mocks.signedIn = false;
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "failed",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("fails cleanly on an HTTP error or an unusable reply", async () => {
  fetchMock.mockResolvedValueOnce(new Response("no", { status: 502 }));
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "failed",
  });
  fetchMock.mockResolvedValueOnce(reply({ nothing: true }));
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "failed",
  });
  fetchMock.mockRejectedValueOnce(new Error("network"));
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "failed",
  });
});

it("requires the persisted daily ops check before the paid request", async () => {
  mocks.check.mockResolvedValueOnce({
    ok: false,
    code: "rate_limited",
    message: "Daily limit",
  });
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "limit",
  });
  expect(mocks.check).toHaveBeenCalledWith("style_format_check", [
    expect.objectContaining({ user_id: mocks.user.id }),
  ]);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mocks.key).not.toHaveBeenCalled();
});

it("a customer's 21st format today returns rate_limited and makes no OpenRouter call", async () => {
  let used = 0;
  mocks.check.mockImplementation(async () =>
    ++used <= 20
      ? { ok: true, data: {} }
      : { ok: false, code: "rate_limited", retry_after: 3600 },
  );
  for (let i = 0; i < 20; i++)
    expect((await formatStyle({ styles: "pop" })).ok).toBe(true);
  fetchMock.mockClear();
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "limit",
  });
  expect(mocks.check).toHaveBeenCalledTimes(21);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refuses the per-minute limit before OpenRouter", async () => {
  mocks.rate.mockReturnValueOnce({ ok: false, retryAfter: 60 });
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "limit",
  });
  expect(mocks.check).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not call the provider when the ops check fails", async () => {
  mocks.check.mockRejectedValueOnce(new Error("database unavailable"));
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "failed",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
