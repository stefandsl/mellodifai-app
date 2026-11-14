import { expect, it } from "vitest";
import { nativeLayout } from "../../lib/native/layout.js";
import { appOrigins } from "../../lib/native/plan.js";
import { runStack } from "../../stack.js";
import { assertNativeIntegrationEnvironment } from "./integration-env.js";

const enabled = process.env.MDF_NATIVE_INTEGRATION === "1";

async function call(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; origin: string | null }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  await response.arrayBuffer();
  return {
    status: response.status,
    origin: response.headers.get("access-control-allow-origin"),
  };
}

it.skipIf(!enabled)(
  "Auth and Storage answer only through the gateway; PostgREST keeps RLS and the app's CORS",
  async () => {
    assertNativeIntegrationEnvironment();
    await runStack("start", "e2e", { runtime: "native" });
    const gateway = process.env.SUPABASE_URL as string;
    const anon = process.env.SUPABASE_ANON_KEY as string;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
    const keyed = (key: string) => ({
      apikey: key,
      authorization: `Bearer ${key}`,
    });
    const { ports } = nativeLayout("e2e");
    const auth = `http://127.0.0.1:${ports.auth}`;
    const storage = `http://127.0.0.1:${ports.storage}`;
    const rest = `http://127.0.0.1:${ports.rest}`;
    const evil = "https://evil.example";

    // Direct: refused before routing, health included, whatever the client sends.
    for (const [url, init] of [
      [`${auth}/health`, {}],
      [`${auth}/settings`, {}],
      [`${auth}/admin/users?per_page=1`, { headers: keyed(service) }],
      [
        `${auth}/otp`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.9",
            "x-mellodifai-hop": "f".repeat(64),
          },
          body: JSON.stringify({ email: "direct@example.test" }),
        },
      ],
      [`${storage}/status`, {}],
      [`${storage}/bucket`, { headers: keyed(service) }],
      [
        `${storage}/bucket`,
        { headers: { ...keyed(service), "x-mellodifai-hop": "f".repeat(64) } },
      ],
    ] as const) {
      const reply = await call(url, init as RequestInit);
      expect(reply.status, url).toBe(403);
      expect(reply.origin, url).toBe(null);
    }
    // Auth's own CORS never answers a direct preflight from any origin.
    const preflight = await call(`${auth}/token?grant_type=password`, {
      method: "OPTIONS",
      headers: { origin: evil, "access-control-request-method": "POST" },
    });
    expect(preflight).toEqual({ status: 403, origin: null });

    // PostgREST: an accepted exposure. Direct reads see only what the public
    // anon role may see, and a foreign page gets no CORS grant to read them.
    const restRead = await call(`${rest}/projects?select=id&limit=1`, {
      headers: { origin: evil },
    });
    expect(restRead.origin).toBe(null);
    const app = appOrigins("e2e")[0] as string;
    expect((await call(`${rest}/`, { headers: { origin: app } })).origin).toBe(
      app,
    );

    // Through the gateway everything still answers.
    expect(
      (await call(`${gateway}/auth/v1/health`, { headers: { apikey: anon } }))
        .status,
    ).toBe(200);
    expect(
      (await call(`${gateway}/auth/v1/settings`, { headers: { apikey: anon } }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(`${gateway}/auth/v1/admin/users?per_page=1`, {
          headers: keyed(service),
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(`${gateway}/storage/v1/bucket`, { headers: keyed(service) }))
        .status,
    ).toBe(200);
    expect(
      (await call(`${gateway}/rest/v1/`, { headers: keyed(anon) })).status,
    ).toBe(200);
  },
);
