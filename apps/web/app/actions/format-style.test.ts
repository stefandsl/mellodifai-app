// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  key: vi.fn(async (): Promise<string | null> => "sk-test-key-123456"),
  user: { id: "u1" } as { id: string },
  signedIn: true,
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth", () => ({
  actionProfile: async () => {
    if (!mocks.signedIn) throw new Error("Unauthorized");
    return { supabase: {}, user: mocks.user };
  },
}));
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

it("limits each person to 20 requests in ten minutes", async () => {
  for (let i = 0; i < 20; i += 1)
    expect(await formatStyle({ styles: "pop" })).toMatchObject({ ok: true });
  expect(await formatStyle({ styles: "pop" })).toEqual({
    ok: false,
    error: "limit",
  });
});
