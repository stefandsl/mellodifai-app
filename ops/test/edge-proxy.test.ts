import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { createEdgeProxy } from "../edge-proxy.js";

const servers: Server[] = [];
let edge: string;
let next: string;
let auth: string;

async function ready(server: Server) {
  servers.push(server);
  if (!server.listening) await once(server, "listening");
  const address = server.address() as AddressInfo;
  expect(address.address).toBe("127.0.0.1");
  return `http://127.0.0.1:${address.port}`;
}

async function upstream(name: string) {
  return ready(
    createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (req.url === "/oauth/redirect") {
        res.writeHead(302, {
          location: "/consent?uid=test",
          "set-cookie": ["first=1; HttpOnly", "second=2; HttpOnly"],
        });
      }
      res.end(
        JSON.stringify({ name, url: req.url, headers: req.headers, body }),
      );
    }).listen(0, "127.0.0.1"),
  );
}

function send(
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
  body = "",
  origin = edge,
) {
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const req = request(origin, { path, method, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: text,
        }),
      );
    });
    req.on("error", reject);
    req.end(body);
  });
}

beforeEach(async () => {
  next = await upstream("next");
  auth = await upstream("auth");
  edge = await ready(createEdgeProxy({ listen: 0, next, auth, mode: "prod" }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

it("an incoming x-mdf-remote: 0 becomes 1", async () => {
  const result = await send("/api/mcp", { "x-mdf-remote": "0" });
  expect(JSON.parse(result.body).headers["x-mdf-remote"]).toBe("1");
});

it("x-forwarded-host and proto are overwritten", async () => {
  for (const path of ["/api/mcp", "/oauth/auth"]) {
    const result = await send(path, {
      host: "attacker.invalid",
      "x-forwarded-host": "attacker.invalid",
      "x-forwarded-proto": "http",
      forwarded: "host=attacker.invalid;proto=http",
      connection: "x-forwarded-host, x-mdf-remote",
    });
    const headers = JSON.parse(result.body).headers;
    expect(headers.host).toBe("app.mellodifai.com");
    expect(headers["x-forwarded-host"]).toBe("app.mellodifai.com");
    expect(headers["x-forwarded-proto"]).toBe("https");
    expect(headers["x-mdf-remote"]).toBe("1");
    expect(headers.forwarded).toBeUndefined();
  }
});

it("local mode does not set x-mdf-remote and forwards its actual http origin", async () => {
  const local = await ready(
    createEdgeProxy({ listen: 0, next, auth, mode: "local" }),
  );
  const result = await send(
    "/login",
    {
      "x-mdf-remote": "1",
      "x-forwarded-host": "bad",
      "x-forwarded-proto": "https",
    },
    "GET",
    "",
    local,
  );
  const headers = JSON.parse(result.body).headers;
  expect(headers["x-mdf-remote"]).toBeUndefined();
  expect(headers["x-forwarded-host"]).toBe(new URL(local).host);
  expect(headers["x-forwarded-proto"]).toBe("http");
});

it("Next-Action on /api/v1 is refused", async () => {
  for (const path of [
    "/api/v1",
    "/api/v1/songs",
    "/api/mcp",
    "/auth/confirm",
    "/oauth/auth",
  ]) {
    expect((await send(path, { "Next-Action": "action" }, "POST")).status).toBe(
      403,
    );
  }
  for (const path of ["/login", "/consent"]) {
    expect((await send(path, { "Next-Action": "action" }, "POST")).status).toBe(
      200,
    );
  }
});

it("local mode routes UI destinations to Next while production denies them", async () => {
  const local = await ready(
    createEdgeProxy({ listen: 0, next, auth, mode: "local" }),
  );
  for (const path of [
    "/create",
    "/library",
    "/",
    "/_next/data/build/create.json",
  ]) {
    expect((await send(path)).status, path).toBe(404);
    const result = await send(path, {}, "GET", "", local);
    expect(result.status, path).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ name: "next", url: path });
  }
  for (const path of [
    "/oauth/auth",
    "/.well-known/oauth-authorization-server/oauth",
    "/.well-known/openid-configuration/oauth",
  ]) {
    const result = await send(path, {}, "GET", "", local);
    expect(JSON.parse(result.body)).toMatchObject({ name: "auth", url: path });
  }
});

it("the 11th registration in an hour from one IP gets 429", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const headers = { "cf-connecting-ip": "192.0.2.1" };
  for (let i = 0; i < 10; i++)
    expect((await send("/oauth/reg", headers, "POST")).status).toBe(200);
  now += 60_001;
  const blocked = await send("/oauth/reg?client=test", headers, "POST");
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers["retry-after"])).toBe(3540);
  expect((await send("/oauth/reg/", headers, "POST")).status).toBe(429);
  expect(
    (await send("/oauth/reg", { "cf-connecting-ip": "192.0.2.2" }, "POST"))
      .status,
  ).toBe(200);
  now += 3_540_000;
  expect((await send("/oauth/reg", headers, "POST")).status).toBe(200);
});

it.each([
  ["/oauth/token", "POST", 60, 60_000],
  ["/login", "POST", 5, 900_000],
  ["/api/mcp", "GET", 120, 60_000],
] as const)(
  "limits %s per cf-connecting-ip",
  async (path, method, max, windowMs) => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const headers = { "cf-connecting-ip": "192.0.2.1" };
    for (let i = 0; i < max; i++)
      expect((await send(path, headers, method)).status).toBe(200);
    const blocked = await send(path, headers, method);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe(String(windowMs / 1000));
    expect(
      (await send(path, { "cf-connecting-ip": "192.0.2.2" }, method)).status,
    ).toBe(200);
    if (path === "/login") expect((await send(path, headers)).status).toBe(200);
    if (path === "/api/mcp")
      expect((await send("/api/v1/songs", headers)).status).toBe(429);
    now += windowMs;
    expect((await send(path, headers, method)).status).toBe(200);
  },
);

it("/rest/v1 and /_next/data return 404", async () => {
  for (const path of [
    "/rest/v1",
    "/rest/v1/songs",
    "/_next/data",
    "/_next/data/build/login.json",
    "/",
    "/library",
    "/auth/v1/token",
    "/storage/v1/file",
    "/api/mcpx",
    "/api/v1evil",
    "/oauth",
    "/login/extra",
    "/api/v1/../../library",
    "/api/v1/%2e%2e/%2e%2e/library",
    "/api/v1/%252e%252e/library",
    "/api/v1/a%2fb",
    "/api/v1/..\\..\\library",
    "//api/mcp",
  ]) {
    expect((await send(path)).status, path).toBe(404);
  }
});

it("/oauth/* goes to auth and /api/mcp to next", async () => {
  const routes = {
    auth: [
      "/oauth/auth",
      "/oauth/.well-known/openid-configuration",
      "/.well-known/oauth-authorization-server/oauth",
      "/.well-known/openid-configuration/oauth",
    ],
    next: [
      "/api/mcp",
      "/api/v1/songs",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
      "/login",
      "/auth/confirm",
      "/consent",
      "/api/health",
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/favicon.ico",
    ],
  };
  for (const [name, paths] of Object.entries(routes)) {
    for (const path of paths) {
      const result = await send(
        `${path}?a=1&b=%2F`,
        { "content-type": "text/plain" },
        "POST",
        "request body",
      );
      expect(result.status, path).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        name,
        url: `${path}?a=1&b=%2F`,
        body: "request body",
      });
    }
  }
});

it("preserves redirects and separate cookies", async () => {
  const result = await send("/oauth/redirect");
  expect(result.status).toBe(302);
  expect(result.headers.location).toBe("/consent?uid=test");
  expect(result.headers["set-cookie"]).toEqual([
    "first=1; HttpOnly",
    "second=2; HttpOnly",
  ]);
});

it("streams MCP events before completion and closes upstream on disconnect", async () => {
  const disconnected = vi.fn();
  const streaming = await ready(
    createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: ready\n\n");
      res.on("close", disconnected);
    }).listen(0, "127.0.0.1"),
  );
  const proxy = await ready(
    createEdgeProxy({ listen: 0, next: streaming, auth, mode: "prod" }),
  );
  const client = request(`${proxy}/api/mcp`);
  client.end();
  const [response] = await once(client, "response");
  const [chunk] = await once(response, "data");
  expect(chunk.toString()).toBe("data: ready\n\n");
  client.destroy();
  await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
});

it("returns 502 when an upstream is unavailable", async () => {
  const server = servers[0];
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  servers.shift();
  expect((await send("/api/mcp")).status).toBe(502);
});

it("the tunnel exposes only the M1 hostname and ends with http_status:404", () => {
  const config = parse(
    readFileSync(
      new URL("../cloudflared/config.template.yml", import.meta.url),
      "utf8",
    ),
  );
  expect(config.ingress).toEqual([
    { hostname: "app.mellodifai.com", service: "http://127.0.0.1:3080" },
    { service: "http_status:404" },
  ]);
});
