import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const exchange = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

import { GET } from "./route";

beforeEach(() => {
  exchange.mockReset();
});
it("redirects only a successful exchange to the protected library", async () => {
  exchange.mockResolvedValue({ error: null });
  const response = await GET(
    new NextRequest("http://localhost/auth/confirm?code=valid"),
  );
  expect(exchange).toHaveBeenCalledWith("valid");
  expect(response.headers.get("location")).toBe("http://localhost/library");
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
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?message=invalid-link",
    );
  },
);
