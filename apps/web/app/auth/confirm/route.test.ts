import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const exchange = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  exchange.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
it("redirects only a successful exchange to the protected library", async () => {
  exchange.mockResolvedValue({ error: null });
  const response = await GET(
    new NextRequest("http://localhost/auth/confirm?code=valid", {
      headers: { host: "127.0.0.1:3000" },
    }),
  );
  expect(exchange).toHaveBeenCalledWith("valid");
  expect(response.headers.get("location")).toBe(
    "http://127.0.0.1:3000/library",
  );
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
