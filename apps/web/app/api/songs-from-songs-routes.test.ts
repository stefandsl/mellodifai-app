// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  user: { id: "4b6f8d2e-1c3a-4e5f-9a7b-2c4d6e8f0a1b" } as { id: string } | null,
  role: "admin",
  uploads: [] as { path: string; type: string }[],
  groq: "gsk-test" as string | null,
  check: vi.fn(),
  rate: vi.fn((): { ok: boolean; retryAfter?: number } => ({ ok: true })),
  key: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mock.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { role: mock.role } }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload: async (
          path: string,
          _body: Blob,
          options: { contentType: string },
        ) => {
          mock.uploads.push({ path, type: options.contentType });
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/openrouter-key", () => ({ groqKey: mock.key }));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mock.check }));
vi.mock("@/lib/ops/context", () => ({
  sessionCtx: async () => ({ actor_kind: "session", user_id: mock.user?.id }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mock.rate }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST as sunoLink } from "./suno-link/route";
import { POST as transcribe } from "./transcribe/route";

const ID = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const json = (body: unknown) =>
  new NextRequest("http://localhost/api/suno-link", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  mock.user = { id: "4b6f8d2e-1c3a-4e5f-9a7b-2c4d6e8f0a1b" };
  mock.uploads = [];
  mock.groq = "gsk-test";
  mock.check.mockReset().mockResolvedValue({ ok: true, data: {} });
  mock.rate.mockReset().mockReturnValue({ ok: true });
  mock.key.mockReset().mockImplementation(async () => mock.groq);
  vi.unstubAllGlobals();
});

describe("Suno share link", () => {
  it("makes one request for the page and one for the audio, into the owner's uploads", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("suno.com/s/")) {
          const page = new Response(
            `<meta property="og:title" content="Canzone by Stefan | Suno"><meta property="og:audio" content="https://cdn1.suno.ai/${ID}.mp3">`,
          );
          Object.defineProperty(page, "url", {
            value: `https://suno.com/song/${ID}`,
          });
          return page;
        }
        return new Response(new Uint8Array([1, 2, 3]));
      }),
    );
    const response = await sunoLink(
      json({ url: "https://suno.com/s/AbCd1234" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(calls).toEqual([
      "https://suno.com/s/AbCd1234",
      `https://cdn1.suno.ai/${ID}.mp3`,
    ]);
    expect(body).toMatchObject({ title: "Canzone", author: "Stefan", size: 3 });
    expect(body.path).toMatch(
      /^4b6f8d2e-1c3a-4e5f-9a7b-2c4d6e8f0a1b\/audio\/[0-9a-f-]{36}\.mp3$/u,
    );
    expect(mock.uploads).toEqual([{ path: body.path, type: "audio/mpeg" }]);
  });
  it("refuses other sites, other audio hosts and anonymous callers without a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await sunoLink(json({ url: "https://example.com/s/AbCd1234" }))).status,
    ).toBe(400);
    mock.user = null;
    expect(
      (await sunoLink(json({ url: "https://suno.com/s/AbCd1234" }))).status,
    ).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not fetch audio from anywhere but Suno's CDN", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        calls.push(String(input));
        return new Response(
          '<meta property="og:audio" content="https://evil.test/x.mp3">',
        );
      }),
    );
    const response = await sunoLink(
      json({ url: "https://suno.com/s/AbCd1234" }),
    );
    expect(response.status).toBe(422);
    expect(calls).toHaveLength(1);
  });
  it("returns an upstream error when the Suno page stream fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(new Error("connection lost"));
              },
            }),
          ),
      ),
    );
    expect(
      (await sunoLink(json({ url: "https://suno.com/s/AbCd1234" }))).status,
    ).toBe(502);
    expect(mock.uploads).toEqual([]);
  });
  it("checks each page redirect before fetching it", async () => {
    for (const destination of [
      "http://127.0.0.1:45621/private",
      "https://example.com/private",
    ]) {
      const fetchMock = vi.fn(
        async (_url: string | URL, _init: RequestInit) =>
          new Response(null, {
            status: 302,
            headers: { location: destination },
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      expect(
        (await sunoLink(json({ url: "https://suno.com/s/AbCd1234" }))).status,
      ).toBe(502);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        redirect: "manual",
      });
    }
  });
  it("follows a Suno page redirect but refuses an audio redirect to another host", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/s/"))
          return new Response(null, {
            status: 302,
            headers: { location: `/song/${ID}` },
          });
        if (url.includes("/song/"))
          return new Response(
            `<meta property="og:audio" content="https://cdn1.suno.ai/${ID}.mp3">`,
          );
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:45621/private" },
        });
      }),
    );
    expect(
      (await sunoLink(json({ url: "https://suno.com/s/AbCd1234" }))).status,
    ).toBe(502);
    expect(urls).toEqual([
      "https://suno.com/s/AbCd1234",
      `https://suno.com/song/${ID}`,
      `https://cdn1.suno.ai/${ID}.mp3`,
    ]);
    expect(mock.uploads).toEqual([]);
  });
});

describe("transcription", () => {
  const form = (lang = "it") => {
    const data = new FormData();
    data.append(
      "file",
      new Blob([new Uint8Array([1, 2])], { type: "audio/wav" }),
      "a.wav",
    );
    data.append("lang", lang);
    return new NextRequest("http://localhost/api/transcribe", {
      method: "POST",
      body: data,
    });
  };
  it("sends the audio to Groq Whisper and answers lyrics and words", async () => {
    let sent: FormData | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = init.body as FormData;
        return new Response(
          JSON.stringify({
            segments: [
              { text: " Prima riga " },
              { text: "[Music]" },
              { text: "Seconda" },
            ],
            words: [{ word: "Prima", start: 1, end: 1.5 }, { word: 3 }],
          }),
        );
      }),
    );
    const response = await transcribe(form());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      lyrics: "Prima riga\nSeconda",
      words: [{ word: "Prima", start: 1, end: 1.5 }],
    });
    expect((sent as unknown as FormData).get("language")).toBe("it");
    expect((sent as unknown as FormData).get("model")).toBe("whisper-large-v3");
    expect(mock.check).toHaveBeenCalledWith("transcribe_check", [
      expect.objectContaining({ user_id: mock.user?.id }),
    ]);
  });
  it("returns an upstream error for malformed Whisper JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{invalid json")),
    );
    const response = await transcribe(form());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "failed" });
  });
  it("returns an upstream error for malformed Whisper segments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ segments: [null] }))),
    );
    const response = await transcribe(form());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "failed" });
  });
  it("needs a signed-in studio user and a key", async () => {
    mock.groq = null;
    expect((await transcribe(form())).status).toBe(503);
    mock.user = null;
    expect((await transcribe(form())).status).toBe(401);
  });
  it("refuses a daily transcription limit before reading the Groq key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mock.check.mockResolvedValueOnce({
      ok: false,
      code: "rate_limited",
      retry_after: 3600,
    });
    const response = await transcribe(form());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "rate_limited",
      retry_after: 3600,
    });
    expect(mock.key).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses the per-minute limit before the database and Groq", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mock.rate.mockReturnValueOnce({ ok: false, retryAfter: 42 });
    const response = await transcribe(form());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.json()).toEqual({
      error: "rate_limited",
      retry_after: 42,
    });
    expect(mock.check).not.toHaveBeenCalled();
    expect(mock.key).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
