// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const exchange = vi.hoisted(() => vi.fn());
const verify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchange, verifyOtp: verify },
  }),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SITE_URL", "https://app.mellodifai.com");
  exchange.mockReset();
  verify.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
it("refuses an unapproved local origin before consuming the credential", async () => {
  const response = await GET(
    new NextRequest("http://localhost:4000/auth/confirm?code=valid"),
  );
  expect(response.status).toBe(400);
  expect(exchange).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
});
it("redirects only a successful exchange to the protected studio", async () => {
  exchange.mockResolvedValue({ error: null });
  const response = await GET(
    new NextRequest("http://localhost/auth/confirm?code=valid", {
      headers: { host: "127.0.0.1:3000" },
    }),
  );
  expect(exchange).toHaveBeenCalledWith("valid");
  expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/create");
});
it.each(["missing", "refused", "transport"])(
  "handles %s code exchange without throwing",
  async (outcome) => {
    if (outcome === "transport")
      exchange.mockRejectedValue(new Error("network"));
    else exchange.mockResolvedValue({ error: { message: "invalid code" } });
    const response = await GET(
      new NextRequest(
        `http://localhost/auth/confirm${outcome === "missing" ? "" : "?code=bad"}`,
        { headers: { host: "127.0.0.1:3000" } },
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login?message=invalid-link",
    );
  },
);

it("verifies a token hash and preserves a consent destination", async () => {
  verify.mockResolvedValue({ error: null });
  const response = await GET(
    new NextRequest(
      "http://localhost/auth/confirm?token_hash=test-hash&type=magiclink&next=%2Fconsent%3Fuid%3Dflow",
      { headers: { host: "127.0.0.1:3000" } },
    ),
  );
  expect(verify).toHaveBeenCalledWith({
    token_hash: "test-hash",
    type: "magiclink",
  });
  expect(response.headers.get("location")).toBe(
    "http://127.0.0.1:3000/consent?uid=flow",
  );
});

it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test"])(
  "refuses unsafe next %s",
  async (next) => {
    verify.mockResolvedValue({ error: null });
    const response = await GET(
      new NextRequest(
        `http://localhost/auth/confirm?token_hash=test-hash&type=email&next=${encodeURIComponent(next)}`,
        { headers: { host: "127.0.0.1:3000" } },
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/create",
    );
  },
);

it.each(["missing", "recovery", "refused", "transport"])(
  "refuses %s token verification",
  async (outcome) => {
    verify.mockResolvedValue({ error: { message: "invalid" } });
    if (outcome === "transport") verify.mockRejectedValue(new Error("network"));
    const response = await GET(
      new NextRequest(
        `http://localhost/auth/confirm?token_hash=test-hash${outcome === "missing" ? "" : `&type=${outcome === "recovery" ? outcome : "magiclink"}`}`,
        { headers: { host: "127.0.0.1:3000" } },
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login?message=invalid-link",
    );
  },
);

it.each([
  ["/consent?uid=flow", "/consent?uid=flow"],
  ["/library", "/login"],
  ["/consent?uid=flow&next=evil", "/login"],
])("remote confirmation restricts next %s", async (next, expected) => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SITE_URL", "https://app.mellodifai.com");
  verify.mockResolvedValue({ error: null });
  const response = await GET(
    new NextRequest(
      `https://app.mellodifai.com/auth/confirm?token_hash=test-hash&type=email&next=${encodeURIComponent(next)}`,
      { headers: { "x-mdf-remote": "1" } },
    ),
  );
  expect(response.headers.get("location")).toBe(
    `https://app.mellodifai.com${expected}`,
  );
});

it("keeps owner sign-in local in production before the public tunnel is available", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SITE_URL", "https://app.mellodifai.com");
  verify.mockResolvedValue({ error: null });
  const response = await GET(
    new NextRequest(
      "http://127.0.0.1:3000/auth/confirm?token_hash=test-hash&type=magiclink",
      { headers: { host: "127.0.0.1:3000" } },
    ),
  );
  expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/create");
});
