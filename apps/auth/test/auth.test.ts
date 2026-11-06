import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { CookieJar } from "tough-cookie";
import { afterEach, describe, expect, it } from "vitest";
import { connectOps, OpsAdapter, type OpsCall } from "../src/adapter.js";
import { flowCookie } from "../src/interaction.js";
import { createAuth } from "../src/main.js";

const hash = (id: string) => createHash("sha256").update(id).digest("hex");
type Payload = Record<string, unknown>;

// A fake of the Task 15 boundary; real SQL invariants live in ops_tokens tests.
function storage() {
  const rows = new Map<string, Payload>();
  const calls: { name: string; args: (string | null)[] }[] = [];
  const nonces = new Map<string, string>();
  const consumed = new Set<string>();
  let open = false;
  const call: OpsCall = async (name, args) => {
    calls.push({ name, args });
    const [model, id, payload, grant, uid] = args;
    const key = `${model}:${id}`;
    switch (name) {
      case "oauth_registration_claim":
        if (!open) return false;
        open = false;
        return true;
      case "oauth_upsert":
        rows.set(key, {
          ...JSON.parse(payload as string),
          _grant: grant,
          _uid: uid,
        });
        return null;
      case "oauth_find": {
        const row = rows.get(key);
        if (!row) return null;
        const { _grant, _uid, ...value } = row;
        return structuredClone(value);
      }
      case "oauth_find_by_uid": {
        const row = [...rows.values()].find((value) => value._uid === model);
        if (!row) return null;
        const { _grant, _uid, ...value } = row;
        return structuredClone(value);
      }
      case "oauth_consume": {
        const row = rows.get(key);
        if (row) row.consumed = Math.floor(Date.now() / 1000);
        return null;
      }
      case "oauth_destroy":
        rows.delete(key);
        return null;
      case "oauth_revoke_by_grant":
        for (const [key, row] of rows)
          if (row._grant === model) rows.delete(key);
        return null;
      case "oauth_flow_nonce_set":
        if (![...rows.values()].some((row) => row._uid === model))
          throw new Error("missing interaction");
        nonces.set(model as string, id as string);
        return null;
      case "oauth_interaction_result": {
        if (
          nonces.get(model as string) !== hash(id as string) ||
          consumed.has(model as string)
        )
          throw new Error("nonce refused");
        consumed.add(model as string);
        const row = [...rows.values()].find((row) => row._uid === model);
        return {
          user_id: "test-owner",
          client_id: (row?.params as Payload | undefined)?.client_id,
          scopes: ["read"],
          test_mode: true,
          token_id: "test-grant",
        };
      }
      case "oauth_bind_grant":
        return null;
    }
  };
  return {
    call,
    rows,
    calls,
    nonces,
    open: () => {
      open = true;
    },
  };
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function harness() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const db = storage();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const app = createAuth({
    issuer: `${origin}/oauth`,
    cookieKeys: [randomBytes(32).toString("hex")],
    jwks: {
      keys: [
        {
          ...privateKey.export({ format: "jwk" }),
          use: "sig",
          alg: "RS256",
          kid: "test",
        },
      ],
    },
    call: db.call,
  });
  server.on("request", app.handler);
  const jar = new CookieJar();
  const request = async (
    path: string,
    options: RequestInit = {},
    cookies = jar,
  ) => {
    const url = new URL(path, origin);
    if (url.origin !== origin)
      throw new Error("Test request left loopback harness");
    const response = await fetch(url, {
      ...options,
      redirect: "manual",
      headers: {
        ...options.headers,
        cookie: await cookies.getCookieString(url.href),
      },
    });
    for (const cookie of response.headers.getSetCookie())
      await cookies.setCookie(cookie, url.href);
    return response;
  };
  const register = (redirects = [`${origin}/callback`], name = "Test client") =>
    request("/oauth/reg", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: redirects,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
  const post = (data: URLSearchParams) =>
    request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: data,
    });
  const verifier = randomBytes(32).toString("base64url");
  const begin = async (scope = "read") => {
    db.open();
    const client = await (await register()).json();
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: `${origin}/callback`,
      response_type: "code",
      scope,
      resource: `${origin}/api/mcp`,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      prompt: "login",
    });
    const response = await request(`/oauth/auth?${params}`);
    expect(response.status).toBe(303);
    const path = response.headers.get("location") as string;
    expect(path).toMatch(/^\/oauth\/interaction\//);
    return { path, uid: path.split("/").at(-1) as string, client, params };
  };
  return { ...app, origin, db, jar, request, register, post, begin, verifier };
}

describe("authorization service", () => {
  it("refuses database URLs that can change the role or host", () => {
    for (const url of [
      "postgresql://postgres@127.0.0.1:45622/postgres",
      "postgresql://mdf_auth@remote.example/postgres",
      "postgresql://mdf_auth@127.0.0.1:45622/postgres?user=postgres",
      "http://mdf_auth@127.0.0.1/postgres",
    ])
      expect(() => connectOps(url)).toThrow("mdf_auth");
  });
  it("discovery is served at /oauth/.well-known/openid-configuration and both path-insertion forms", async () => {
    const app = await harness();
    const documents = [];
    for (const path of [
      "/oauth/.well-known/openid-configuration",
      "/.well-known/oauth-authorization-server/oauth",
      "/.well-known/openid-configuration/oauth",
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      documents.push(await response.json());
    }
    expect(documents[1]).toEqual(documents[0]);
    expect(documents[2]).toEqual(documents[0]);
    expect(documents[0]).toMatchObject({
      issuer: `${app.origin}/oauth`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    });
    expect(documents[0].grant_types_supported.sort()).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
  });

  it("registration outside the window is refused and the first one closes it", async () => {
    const app = await harness();
    expect((await app.register()).status).toBe(403);
    app.db.open();
    const results = await Promise.all([app.register(), app.register()]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 403]);
    expect((await app.register()).status).toBe(403);
  });

  it("a redirect URI off the allowlist is refused without claiming the window", async () => {
    const app = await harness();
    app.db.open();
    for (const uri of [
      "https://evil.example/callback",
      "http://127.0.0.2:8765/cb",
      "http://127.1:8765/cb",
      "http://localhost.evil:8765/cb",
      "http://user@localhost:8765/cb",
      "http://localhost:8765/cb#x",
      "https://chatgpt.com/connector/oauth/invented",
    ])
      expect((await app.register([uri])).status).toBe(400);
    expect(
      app.db.calls.filter((call) => call.name === "oauth_registration_claim"),
    ).toHaveLength(0);
    expect(
      (
        await app.register(
          [
            "https://claude.ai/api/mcp/auth_callback",
            "https://chatgpt.com/connector_platform_oauth_redirect",
          ],
          "<b>🎵</b>".repeat(30),
        )
      ).status,
    ).toBe(201);
    const claim = app.db.calls.find(
      (call) => call.name === "oauth_registration_claim",
    );
    expect(Array.from(claim?.args[1] ?? "").length).toBe(60);
  });

  it("the interaction handler sets the flow cookie and stores only its hash", async () => {
    const app = await harness();
    const flow = await app.begin();
    const response = await app.request(flow.path);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/consent?uid=${flow.uid}`);
    const cookie = (await app.jar.getCookies(`${app.origin}/consent`)).find(
      (cookie) => cookie.key === "mdf_flow",
    );
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 900,
      secure: false,
    });
    expect(Buffer.from(cookie?.value ?? "", "base64url").length).toBe(32);
    expect(app.db.nonces.get(flow.uid)).toBe(hash(cookie?.value ?? ""));
    expect(JSON.stringify(app.db.calls)).not.toContain(cookie?.value);
    expect(
      (await app.jar.getCookies(`${app.origin}${flow.path}/resume`)).some(
        (cookie) => cookie.key === "_interaction",
      ),
    ).toBe(true);
  });

  it("resume without the cookie is refused, including a second browser", async () => {
    const app = await harness();
    const flow = await app.begin();
    await app.request(flow.path);
    expect(
      (await app.request(`${flow.path}/resume`, {}, new CookieJar())).status,
    ).toBe(403);
    expect(
      app.db.calls.some((call) => call.name === "oauth_interaction_result"),
    ).toBe(false);
    expect((await app.request(flow.path, {}, new CookieJar())).status).toBe(
      403,
    );
  });

  it("uses the HTTPS Host cookie and rejects the older of two browser flows", async () => {
    expect(flowCookie("https://app.mellodifai.com/oauth", "nonce")).toBe(
      "__Host-mdf_flow=nonce; Path=/; HttpOnly; SameSite=Lax; Max-Age=900; Secure",
    );
    const app = await harness();
    const first = await app.begin();
    await app.request(first.path);
    const second = await app.begin();
    await app.request(second.path);
    expect((await app.request(`${first.path}/resume`)).status).toBe(403);
    expect((await app.request(`${second.path}/resume`)).status).toBe(303);
  });

  it("the adapter never stores jti and implements hashed lookup, consumption and deletion", async () => {
    const db = storage();
    const adapter = new OpsAdapter("AccessToken", db.call);
    await adapter.upsert(
      "opaque-value",
      { jti: "opaque-value", grantId: "grant", scope: "read" },
      3600,
    );
    expect(JSON.stringify(db.calls)).not.toContain("opaque-value");
    expect(db.rows.has(`AccessToken:${hash("opaque-value")}`)).toBe(true);
    expect(await adapter.find("opaque-value")).toMatchObject({
      jti: "opaque-value",
      scope: "read",
    });
    await adapter.consume("opaque-value");
    expect((await adapter.find("opaque-value"))?.consumed).toBeTypeOf("number");
    await adapter.destroy("opaque-value");
    expect(await adapter.find("opaque-value")).toBeUndefined();
    await adapter.upsert("other", { grantId: "grant" }, 60);
    await adapter.revokeByGrantId("grant");
    expect(db.rows.size).toBe(0);
  });

  it("binds exact consent scopes, exchanges a code and rotates refresh tokens with explicit resource", async () => {
    const app = await harness();
    const flow = await app.begin("openid offline_access read create spend");
    await app.request(flow.path);
    const resume = await app.request(`${flow.path}/resume`);
    expect(resume.status).toBe(303);
    const authorized = await app.request(
      resume.headers.get("location") as string,
    );
    const redirect = new URL(authorized.headers.get("location") as string);
    expect(redirect.searchParams.get("iss")).toBe(`${app.origin}/oauth`);
    const exchange = await app.post(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: flow.client.client_id,
        code: redirect.searchParams.get("code") as string,
        code_verifier: app.verifier,
        redirect_uri: `${app.origin}/callback`,
        resource: `${app.origin}/api/mcp`,
      }),
    );
    expect(exchange.status).toBe(200);
    const tokens = await exchange.json();
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.access_token).not.toContain(".");
    expect(tokens.refresh_token).toBeTruthy();
    const binds = app.db.calls.filter(
      (call) => call.name === "oauth_bind_grant",
    );
    expect(binds).toHaveLength(1);
    expect(binds[0]?.args[0]).toBe(flow.uid);
    for (const model of ["AuthorizationCode", "AccessToken", "RefreshToken"]) {
      const call = app.db.calls.find(
        (call) => call.name === "oauth_upsert" && call.args[0] === model,
      );
      expect(call?.args[3]).toBe(binds[0]?.args[1]);
      expect(call?.args[4]).toBeNull();
      const payload = JSON.parse(call?.args[2] ?? "{}");
      expect(payload).not.toHaveProperty("jti");
      expect(payload.scope).toBe("read");
      expect(payload.exp - payload.iat).toBe(
        model === "AccessToken"
          ? 3600
          : model === "RefreshToken"
            ? 2592000
            : 600,
      );
    }
    // MCP refresh must outlive the 15-minute browser session.
    for (const key of app.db.rows.keys()) {
      if (key.startsWith("Session:")) app.db.rows.delete(key);
    }
    const refreshParams = () =>
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: flow.client.client_id,
        refresh_token: tokens.refresh_token,
      });
    for (const resources of [
      [],
      ["https://evil.example"],
      [`${app.origin}/api/mcp`, `${app.origin}/api/mcp`],
    ]) {
      const params = refreshParams();
      for (const resource of resources) params.append("resource", resource);
      expect((await app.post(params)).status).toBe(400);
    }
    const oversized = refreshParams();
    oversized.set("resource", `${app.origin}/api/mcp`);
    oversized.set("padding", "x".repeat(57 * 1024));
    expect((await app.post(oversized)).status).toBe(400);
    const params = refreshParams();
    params.set("resource", `${app.origin}/api/mcp`);
    const refreshed = await app.post(params);
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).refresh_token).not.toBe(
      tokens.refresh_token,
    );
    expect((await app.post(params)).status).toBe(400);
    expect((await app.request(`${flow.path}/resume`)).status).toBe(403);
  });

  it("rejects missing/foreign resource and missing/plain PKCE before consent", async () => {
    const app = await harness();
    const flow = await app.begin();
    for (const [name, value] of [
      ["resource", ""],
      ["resource", "https://evil.example"],
      ["code_challenge", ""],
      ["code_challenge_method", "plain"],
    ]) {
      const params = new URLSearchParams(flow.params);
      if (value) params.set(name as string, value);
      else params.delete(name as string);
      const response = await app.request(`/oauth/auth?${params}`);
      expect(
        new URL(response.headers.get("location") as string).searchParams.has(
          "error",
        ),
      ).toBe(true);
    }
  });
});
