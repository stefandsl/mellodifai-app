import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  type ClientRequest,
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestListener,
  request,
  type Server,
} from "node:http";
import { type AddressInfo, connect, type Socket } from "node:net";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  createGateway,
  DEFAULT_GATEWAY_LIMITS,
  type GatewayConfig,
  type GatewayLimits,
  type GatewayLogEntry,
  parseGatewayConfig,
} from "../../lib/native/gateway.js";
import { loadGatewayConfig } from "../../native-gateway.js";

// Made-up credentials: nothing here signs or opens anything.
const ANON = `anon.${"a".repeat(40)}`;
const SERVICE = `service.${"s".repeat(40)}`;
const USER_JWT = "user-header.user-payload.user-signature";
const APP = "http://127.0.0.1:3999";
const MIB = 1024 * 1024;
const tempBase = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";

interface Seen {
  name: string;
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}
interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  text: string;
}
type Headers = Record<string, string | string[]>;

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
});

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address() as AddressInfo;
  expect(address.address).toBe("127.0.0.1");
  return address.port;
}

/** A free loopback port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function stack(
  options: {
    auth?: RequestListener;
    rest?: RequestListener;
    storage?: RequestListener;
    limits?: Partial<GatewayLimits>;
    appOrigins?: string[];
    down?: "auth" | "rest" | "storage";
  } = {},
) {
  const seen: Seen[] = [];
  const logs: GatewayLogEntry[] = [];
  const echo =
    (name: string): RequestListener =>
    async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const record = {
        name,
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      };
      seen.push(record);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(record));
    };
  const ports = { auth: 0, rest: 0, storage: 0 };
  for (const name of ["auth", "rest", "storage"] as const)
    ports[name] =
      options.down === name
        ? await closedPort()
        : await listen(createServer(options[name] ?? echo(name)));
  const config: GatewayConfig = {
    host: "127.0.0.1",
    port: 0,
    upstreams: {
      auth: `http://127.0.0.1:${ports.auth}`,
      rest: `http://127.0.0.1:${ports.rest}`,
      storage: `http://127.0.0.1:${ports.storage}`,
    },
    keys: { anon: ANON, service: SERVICE },
    appOrigins: options.appOrigins ?? [APP],
    ...(options.limits ? { limits: options.limits } : {}),
    log: (entry) => logs.push(entry),
  };
  const port = await listen(createGateway(config));
  return { port, ports, seen, logs, config };
}

function open(
  port: number,
  path: string,
  options: { method?: string; headers?: Headers } = {},
): ClientRequest {
  return request({
    host: "127.0.0.1",
    port,
    path,
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    agent: false,
  });
}

async function collect(response: IncomingMessage): Promise<Reply> {
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  return {
    status: response.statusCode ?? 0,
    headers: response.headers,
    body,
    text: body.toString(),
  };
}

async function send(
  port: number,
  path: string,
  options: { method?: string; headers?: Headers; body?: string | Buffer } = {},
): Promise<Reply> {
  const req = open(port, path, options);
  req.end(options.body);
  const [response] = (await once(req, "response")) as [IncomingMessage];
  return collect(response);
}

const seenBy = (reply: Reply) => JSON.parse(reply.text) as Seen;
const withKey = (key = ANON, extra: Headers = {}): Headers => ({
  apikey: key,
  authorization: `Bearer ${USER_JWT}`,
  ...extra,
});

/**
 * Writes raw bytes and returns everything the gateway sent until it closed the
 * connection. The client never closes first: Node drops what is still pending
 * on a connection whose client has half-closed.
 */
function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let reply = "";
    socket.setEncoding("latin1");
    socket.on("data", (chunk: string) => {
      reply += chunk;
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(reply));
    socket.on("connect", () => socket.write(text, "latin1"));
  });
}

// A second status line follows the first body with no line break between.
const statuses = (reply: string) =>
  [...reply.matchAll(/HTTP\/1\.1 (\d{3}) /g)].map((match) => Number(match[1]));

async function stream(req: ClientRequest, chunk: Buffer, count: number) {
  for (let index = 0; index < count; index++)
    if (!req.write(chunk)) await once(req, "drain");
  req.end();
}

it("accepts the agreed config shape and fills in the default limits", () => {
  const config = parseGatewayConfig({
    host: "127.0.0.1",
    port: 45621,
    upstreams: {
      auth: "http://127.0.0.1:45620",
      rest: "http://127.0.0.1:45628",
      storage: "http://127.0.0.1:45629",
    },
    keys: { anon: ANON, service: SERVICE },
    appOrigins: ["http://127.0.0.1:3210", "https://app.mellodifai.com"],
    limits: { upstreamTimeoutMs: 30_000 },
  });
  expect(config).toEqual({
    host: "127.0.0.1",
    port: 45621,
    upstreams: {
      auth: "http://127.0.0.1:45620",
      rest: "http://127.0.0.1:45628",
      storage: "http://127.0.0.1:45629",
    },
    keys: { anon: ANON, service: SERVICE },
    appOrigins: ["http://127.0.0.1:3210", "https://app.mellodifai.com"],
    limits: { upstreamTimeoutMs: 30_000 },
  });
  expect(DEFAULT_GATEWAY_LIMITS).toEqual({
    maxHeaderBytes: 32 * 1024,
    maxUrlBytes: 8 * 1024,
    maxConnections: 512,
    headersTimeoutMs: 15_000,
    requestTimeoutMs: 300_000,
    idleTimeoutMs: 60_000,
    upstreamTimeoutMs: 60_000,
  });
});

it("refuses a config that would expose or misroute the gateway, never echoing a key", () => {
  const valid = (): Record<string, unknown> => ({
    host: "127.0.0.1",
    port: 45621,
    upstreams: {
      auth: "http://127.0.0.1:45620",
      rest: "http://127.0.0.1:45628",
      storage: "http://127.0.0.1:45629",
    },
    keys: { anon: ANON, service: SERVICE },
    appOrigins: [APP],
    limits: {},
  });
  // Each case changes one thing; an object is merged into the valid section.
  const broken: [string, Record<string, unknown>][] = [
    ["any-interface host", { host: "0.0.0.0" }],
    ["named host", { host: "localhost" }],
    ["negative port", { port: -1 }],
    ["port above range", { port: 65536 }],
    ["text port", { port: "45621" }],
    ["https upstream", { upstreams: { auth: "https://127.0.0.1:45620" } }],
    ["LAN upstream", { upstreams: { rest: "http://192.168.1.20:3000" } }],
    ["named upstream", { upstreams: { rest: "http://localhost:45628" } }],
    ["upstream path", { upstreams: { rest: "http://127.0.0.1:45628/x" } }],
    ["upstream slash", { upstreams: { rest: "http://127.0.0.1:45628/" } }],
    [
      "upstream login",
      { upstreams: { storage: "http://user:pass@127.0.0.1:45629" } },
    ],
    ["upstream without port", { upstreams: { auth: "http://127.0.0.1" } }],
    ["missing upstream", { upstreams: { storage: undefined } }],
    [
      "undeclared upstream",
      { upstreams: { realtime: "http://127.0.0.1:45627" } },
    ],
    ["shared upstream", { upstreams: { rest: "http://127.0.0.1:45620" } }],
    ["upstream loop", { upstreams: { rest: "http://127.0.0.1:45621" } }],
    ["short key", { keys: { anon: "anon" } }],
    ["key with a space", { keys: { service: `${SERVICE} x` } }],
    ["one key for both", { keys: { anon: SERVICE } }],
    ["missing key", { keys: { service: undefined } }],
    ["undeclared key", { keys: { jwt: SERVICE } }],
    ["origin with a slash", { appOrigins: [`${APP}/`] }],
    ["origin without scheme", { appOrigins: ["127.0.0.1:3999"] }],
    ["wildcard origin", { appOrigins: ["*"] }],
    ["null origin", { appOrigins: ["null"] }],
    ["origins not a list", { appOrigins: APP }],
    ["unknown limit", { limits: { maxSockets: 5 } }],
    ["zero limit", { limits: { maxConnections: 0 } }],
    ["fractional limit", { limits: { maxUrlBytes: 1.5 } }],
    ["text limit", { limits: { idleTimeoutMs: "5000" } }],
    ["headers outlast the request", { limits: { headersTimeoutMs: 400_000 } }],
    ["unknown field", { realtime: true }],
    ["log that is no function", { log: "stdout" }],
  ];
  for (const [name, change] of broken) {
    const config = valid();
    for (const [field, value] of Object.entries(change))
      config[field] =
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? { ...(config[field] as object), ...value }
          : value;
    let message = "";
    try {
      parseGatewayConfig(config);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message, name).toMatch(/^Invalid gateway config: /);
    expect(message, name).not.toContain(ANON);
    expect(message, name).not.toContain(SERVICE);
  }
  for (const value of ["http://127.0.0.1:45621", null, 45621, [valid()]])
    expect(() => parseGatewayConfig(value)).toThrow(
      "Invalid gateway config: config must be an object",
    );
  expect(() => createGateway({ ...valid(), host: "0.0.0.0" } as never)).toThrow(
    'Invalid gateway config: host must be "127.0.0.1"',
  );
});

it("forwards only the three services, with the prefix removed and the query untouched", async () => {
  const { port, seen } = await stack();
  const query = "?select=*,takes(id)&name=eq.a%20b&or=(a.eq.1,b.eq.2)&x=%2F";
  for (const [path, name, url] of [
    [`/rest/v1/songs${query}`, "rest", `/songs${query}`],
    ["/rest/v1/rpc/health", "rest", "/rpc/health"],
    ["/rest/v1/", "rest", "/"],
    ["/rest/v1", "rest", "/"],
    ["/rest/v1?select=id", "rest", "/?select=id"],
    [
      "/auth/v1/token?grant_type=password",
      "auth",
      "/token?grant_type=password",
    ],
    [
      "/auth/v1/admin/users?page=1&per_page=1",
      "auth",
      "/admin/users?page=1&per_page=1",
    ],
    ["/auth/v1/health", "auth", "/health"],
    [
      "/storage/v1/object/previews/a%20b/%C3%A8.mp3",
      "storage",
      "/object/previews/a%20b/%C3%A8.mp3",
    ],
    ["/storage/v1/object/list/previews", "storage", "/object/list/previews"],
    ["/storage/v1/status", "storage", "/status"],
    [
      "/storage/v1/object/previews/100%25.mp3",
      "storage",
      "/object/previews/100%25.mp3",
    ],
  ] as const) {
    const reply = await send(port, path, {
      method: "POST",
      headers: withKey(SERVICE, { "content-type": "application/json" }),
      body: '{"a":1}',
    });
    expect(reply.status, path).toBe(200);
    expect(seenBy(reply), path).toMatchObject({
      name,
      url,
      method: "POST",
      body: '{"a":1}',
    });
  }
  expect(seen).toHaveLength(12);
});

it("answers 404 for Realtime and every route outside the three services", async () => {
  const { port, seen, logs } = await stack();
  for (const path of [
    "/",
    "/realtime/v1",
    "/realtime/v1/websocket?apikey=x&vsn=1.0.0",
    "/realtime/v1/api/broadcast",
    "/functions/v1/hello",
    "/graphql/v1",
    "/analytics/v1/logs",
    "/pg/tables",
    "/mcp",
    "/api/mcp",
    "/auth",
    "/auth/v1x/token",
    "/auth/v2/token",
    "/rest/v1evil",
    "/storage",
    "/Rest/v1/songs",
    "/healthz",
    "/health/extra",
  ]) {
    for (const method of ["GET", "POST", "OPTIONS"]) {
      const reply = await send(port, path, {
        method,
        headers: withKey(SERVICE, { origin: APP }),
      });
      expect(reply.status, `${method} ${path}`).toBe(404);
      expect(JSON.parse(reply.text)).toEqual({ message: "Not found" });
    }
  }
  expect(seen).toHaveLength(0);
  expect(logs.every((entry) => entry.route === "none")).toBe(true);
});

it("refuses paths an upstream could read differently from the gateway", async () => {
  const { port, seen } = await stack();
  for (const path of [
    "/rest/v1/../auth/v1/admin/users",
    "/rest/v1/./songs",
    "/rest/v1/%2e%2e/songs",
    "/rest/v1/%2E%2E/songs",
    "/rest/v1/.%2e/songs",
    "/auth/v1/verify/..%2fadmin/users",
    "/auth/v1/verify%2f..%2fadmin",
    "/storage/v1/object/sign/previews/%2e%2e/secret?token=t",
    "/storage/v1/object/sign/previews/a%5c..%5cb?token=t",
    "/storage/v1/object/sign/previews/a\\b?token=t",
    "//rest/v1/songs",
    "/rest/v1//songs",
    "/rest//v1/songs",
    "/rest/v1/a%2Fb",
    "/rest/v1/%zz",
    "/rest/v1/%",
    "/rest/v1/%00",
    "/rest/v1/a%0d%0ab",
    "/rest/v1/%ff",
    "/rest/v1/songs#fragment",
  ]) {
    const reply = await send(port, path, { headers: withKey(SERVICE) });
    expect(reply.status, path).toBe(400);
    expect(JSON.parse(reply.text)).toEqual({
      message: "Invalid request target",
    });
  }
  // Absolute-form and authority-form targets never name a route either.
  for (const target of ["http://127.0.0.1/rest/v1/songs", "*", "rest/v1/songs"])
    expect(
      statuses(
        await raw(
          port,
          `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\napikey: ${SERVICE}\r\nConnection: close\r\n\r\n`,
        ),
      ),
      target,
    ).toEqual([400]);
  expect(seen).toHaveLength(0);
});

it("asks for a configured apikey, with Kong's 401 body, before anything reaches a service", async () => {
  const { port, seen, logs } = await stack();
  const missing: Headers[] = [
    {},
    { authorization: `Bearer ${USER_JWT}` },
    { authorization: `Basic ${Buffer.from(SERVICE).toString("base64")}` },
    { "x-api-key": SERVICE },
  ];
  const wrong: Headers[] = [
    { apikey: "" },
    { apikey: "not-a-key" },
    { apikey: ANON.slice(0, -1) },
    { apikey: `${ANON}a` },
    { apikey: ANON.toUpperCase() },
    { apikey: [ANON, SERVICE] },
    { apikey: `Bearer ${ANON}` },
    // The header decides when present, as with Kong's key-auth.
    { apikey: "not-a-key", authorization: `Bearer ${SERVICE}` },
  ];
  for (const path of [
    "/rest/v1/songs",
    "/auth/v1/token?grant_type=password",
    "/auth/v1/health",
    "/storage/v1/object/previews/a.mp3",
    "/storage/v1/status",
  ]) {
    for (const [headers, message, error] of [
      ...missing.map(
        (h) => [h, "No API key found in request", "apikey_missing"] as const,
      ),
      ...wrong.map(
        (h) =>
          [h, "Invalid authentication credentials", "apikey_wrong"] as const,
      ),
    ]) {
      const reply = await send(port, path, { method: "POST", headers });
      expect(reply.status, path).toBe(401);
      expect(JSON.parse(reply.text)).toEqual({ message });
      expect(reply.headers["content-type"]).toBe(
        "application/json; charset=utf-8",
      );
      expect(reply.headers["www-authenticate"]).toBe('Key realm="mellodifai"');
      expect(logs.at(-1)).toMatchObject({ status: 401, key: "none", error });
    }
  }
  // The key is not accepted from the query string: it would end up in logs.
  expect((await send(port, `/rest/v1/songs?apikey=${SERVICE}`)).status).toBe(
    401,
  );
  expect(seen).toHaveLength(0);
});

it("lets the anon and service keys through and keeps the caller's Authorization", async () => {
  const { port, logs } = await stack();
  for (const [key, kind] of [
    [ANON, "anon"],
    [SERVICE, "service"],
  ] as const) {
    for (const route of ["auth", "rest", "storage"] as const) {
      const reply = await send(port, `/${route}/v1/thing`, {
        headers: withKey(key),
      });
      expect(reply.status).toBe(200);
      const { headers } = seenBy(reply);
      expect(headers.authorization).toBe(`Bearer ${USER_JWT}`);
      // PostgREST exposes request headers to SQL; like Kong, hide the key there.
      expect(headers.apikey).toBe(route === "rest" ? undefined : key);
      expect(logs.at(-1)).toMatchObject({ route, status: 200, key: kind });
    }
    // supabase-js sends the key as the bearer when nobody is signed in.
    const bearer = await send(port, "/rest/v1/songs", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(bearer.status).toBe(200);
    expect(seenBy(bearer).headers.authorization).toBe(`Bearer ${key}`);
    expect(logs.at(-1)).toMatchObject({ key: kind });
  }
});

it("opens the magic-link navigation without a key, and nothing else on Auth", async () => {
  const { port, seen, logs } = await stack({
    auth: (req, res) => {
      seen.push({
        name: "auth",
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: "",
      });
      res
        .writeHead(303, {
          location: `${APP}/auth/confirm#access_token=session-token`,
          "set-cookie": ["first=1; HttpOnly", "second=2; HttpOnly"],
        })
        .end();
    },
  });
  const link =
    "/auth/v1/verify?token=magic-token&type=magiclink&redirect_to=http%3A%2F%2F127.0.0.1%3A3999%2Fauth%2Fconfirm";
  const reply = await send(port, link, {
    headers: { cookie: "sb-session=cookie-secret" },
  });
  expect(reply.status).toBe(303);
  expect(reply.headers.location).toBe(
    `${APP}/auth/confirm#access_token=session-token`,
  );
  expect(reply.headers["set-cookie"]).toEqual([
    "first=1; HttpOnly",
    "second=2; HttpOnly",
  ]);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({
    method: "GET",
    url: link.slice("/auth/v1".length),
  });
  expect(logs.at(-1)).toMatchObject({
    route: "auth",
    path: "/auth/v1/verify",
    status: 303,
    key: "public",
  });
  for (const [method, path] of [
    ["POST", "/auth/v1/verify"],
    ["HEAD", link],
    ["PUT", link],
    ["GET", "/auth/v1/verify/"],
    ["GET", "/auth/v1/verify/extra?token=t"],
    ["GET", "/auth/v1/verifyx?token=t"],
    ["GET", "/auth/v1/Verify?token=t"],
    ["GET", "/auth/v1/callback?code=c"],
    ["GET", "/auth/v1/authorize?provider=github"],
    ["GET", "/auth/v1/user"],
    ["GET", "/auth/v1/admin/users"],
    ["GET", "/rest/v1/verify?token=t"],
    ["GET", "/storage/v1/verify?token=t"],
  ] as const)
    expect(
      (await send(port, path, { method })).status,
      `${method} ${path}`,
    ).toBe(401);
  expect(seen).toHaveLength(1);
});

it("opens signed playback links without a key, and no other Storage route", async () => {
  const { port, seen, logs } = await stack();
  const link =
    "/storage/v1/object/sign/previews/user-1/take%201.mp3?token=signed-token-value&download=take.mp3";
  for (const method of ["GET", "HEAD"]) {
    const reply = await send(port, link, { method });
    expect(reply.status).toBe(200);
    expect(seen.at(-1)).toMatchObject({
      name: "storage",
      method,
      url: link.slice("/storage/v1".length),
    });
    expect(logs.at(-1)).toMatchObject({
      route: "storage",
      path: "/storage/v1/object/sign/previews/user-1/take%201.mp3",
      key: "public",
    });
  }
  const count = seen.length;
  for (const [method, path] of [
    // Creating a signed link is an authenticated call.
    ["POST", "/storage/v1/object/sign/previews/user-1/take.mp3"],
    ["POST", link],
    ["DELETE", link],
    ["PUT", link],
    ["GET", "/storage/v1/object/sign/previews/user-1/take.mp3"],
    ["GET", "/storage/v1/object/sign/previews/user-1/take.mp3?token="],
    ["GET", "/storage/v1/object/sign/previews/user-1/take.mp3?Token=t"],
    ["GET", "/storage/v1/object/sign/previews?token=t"],
    ["GET", "/storage/v1/object/sign/previews/?token=t"],
    ["GET", "/storage/v1/object/sign?token=t"],
    ["GET", "/storage/v1/object/signature/previews/a.mp3?token=t"],
    ["GET", "/storage/v1/object/previews/user-1/take.mp3?token=t"],
    ["GET", "/storage/v1/object/public/previews/a.mp3"],
    ["GET", "/storage/v1/object/authenticated/previews/a.mp3?token=t"],
    ["GET", "/storage/v1/object/info/previews/a.mp3?token=t"],
    ["PUT", "/storage/v1/object/upload/sign/previews/a.mp3?token=t"],
    ["GET", "/storage/v1/render/image/sign/previews/a.png?token=t"],
    ["GET", "/storage/v1/bucket?token=t"],
    ["GET", "/auth/v1/object/sign/previews/a.mp3?token=t"],
  ] as const)
    expect(
      (await send(port, path, { method })).status,
      `${method} ${path}`,
    ).toBe(401);
  expect(seen).toHaveLength(count);
});

it("replaces forged identity and forwarding headers with its own", async () => {
  const { port, ports } = await stack();
  for (const route of ["auth", "rest", "storage"] as const) {
    const reply = await send(port, `/${route}/v1/thing`, {
      headers: withKey(ANON, {
        "x-forwarded-for": "203.0.113.9",
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "https",
        "x-forwarded-port": "443",
        "x-forwarded-prefix": "/evil",
        "x-forwarded-path": "/evil/path",
        "x-forwarded-user": "owner",
        forwarded: "for=203.0.113.9;host=attacker.invalid;proto=https",
        "x-real-ip": "203.0.113.9",
        "x-client-ip": "203.0.113.9",
        "true-client-ip": "203.0.113.9",
        "cf-connecting-ip": "203.0.113.9",
        "sb-forwarded-for": "203.0.113.9",
        "x-original-url": "/admin/users",
        "x-rewrite-url": "/admin/users",
        "x-consumer-username": "service_role",
        "x-consumer-id": "1",
        "x-credential-identifier": "service_role",
        "x-anonymous-consumer": "false",
        "x-client-info": "supabase-js/2.118.0",
        "accept-profile": "public",
      }),
    });
    expect(reply.status).toBe(200);
    const { headers } = seenBy(reply);
    expect(headers).toMatchObject({
      host: `127.0.0.1:${ports[route]}`,
      "x-forwarded-for": "127.0.0.1",
      "x-forwarded-host": `127.0.0.1:${port}`,
      "x-forwarded-proto": "http",
      "x-forwarded-port": String(port),
      "x-forwarded-prefix": `/${route}/v1`,
      "x-client-info": "supabase-js/2.118.0",
      "accept-profile": "public",
    });
    expect(
      Object.keys(headers).filter(
        (name) =>
          /^(x-forwarded-|x-consumer-|forwarded$|x-real|x-client-ip|true-client|cf-|sb-|x-original|x-rewrite|x-credential|x-anonymous)/.test(
            name,
          ) &&
          ![
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
            "x-forwarded-port",
            "x-forwarded-prefix",
          ].includes(name),
      ),
    ).toEqual([]);
    expect(JSON.stringify(headers)).not.toMatch(/203\.0\.113\.9|attacker|evil/);
  }
});

it("serves only the loopback names of its own port", async () => {
  const { port, seen } = await stack();
  for (const host of [
    "attacker.invalid",
    `attacker.invalid:${port}`,
    `127.0.0.1:${port + 1}`,
    "127.0.0.1",
    `127.0.0.1.attacker.invalid:${port}`,
    `[::1]:${port}`,
  ]) {
    for (const path of ["/rest/v1/songs", "/health"]) {
      const reply = await send(port, path, {
        headers: withKey(SERVICE, { host }),
      });
      expect(reply.status, host).toBe(421);
    }
  }
  expect(seen).toHaveLength(0);
  const named = await send(port, "/rest/v1/songs", {
    headers: withKey(ANON, { host: `localhost:${port}` }),
  });
  expect(named.status).toBe(200);
  expect(seenBy(named).headers["x-forwarded-host"]).toBe(`localhost:${port}`);
});

it("answers the Supabase client's preflight for app origins only", async () => {
  const { port, seen } = await stack({
    appOrigins: [APP, "https://app.mellodifai.com"],
  });
  const asked =
    "apikey, authorization, x-client-info, content-type, x-supabase-api-version, accept-profile, content-profile, x-retry-count, prefer, range, x-upsert, cache-control, if-none-match, tus-resumable, upload-length, upload-metadata, upload-offset, x-http-method-override";
  for (const origin of [APP, "https://app.mellodifai.com"]) {
    for (const path of [
      "/rest/v1/songs?select=*",
      "/auth/v1/token?grant_type=password",
      "/storage/v1/object/previews/a.mp3",
      "/storage/v1/upload/resumable",
    ]) {
      for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"]) {
        const reply = await send(port, path, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": method,
            "access-control-request-headers": asked,
          },
        });
        expect(reply.status, `${method} ${path}`).toBe(204);
        expect(reply.body).toHaveLength(0);
        expect(reply.headers).toMatchObject({
          "access-control-allow-origin": origin,
          "access-control-allow-methods":
            "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": asked,
          "access-control-max-age": "600",
          vary: "Origin",
        });
        expect(reply.headers["access-control-allow-credentials"]).toBe(
          undefined,
        );
        expect(reply.headers["access-control-allow-private-network"]).toBe(
          undefined,
        );
      }
    }
  }
  // A public page calling loopback: Chrome asks for the private network too.
  const privateNetwork = await send(port, "/rest/v1/songs", {
    method: "OPTIONS",
    headers: {
      origin: "https://app.mellodifai.com",
      "access-control-request-method": "GET",
      "access-control-request-private-network": "true",
    },
  });
  expect(privateNetwork.status).toBe(204);
  expect(privateNetwork.headers["access-control-allow-private-network"]).toBe(
    "true",
  );
  expect(privateNetwork.headers["access-control-allow-headers"]).toBe(
    undefined,
  );
  // A header list that is not a list of names is not repeated back.
  const malformed = await send(port, "/rest/v1/songs", {
    method: "OPTIONS",
    headers: {
      origin: APP,
      "access-control-request-method": "GET",
      "access-control-request-headers": "apikey; <script>",
    },
  });
  expect(malformed.headers["access-control-allow-headers"]).toBe(undefined);

  for (const origin of [
    "http://attacker.invalid",
    "http://127.0.0.1:4000",
    "http://localhost:3999",
    "https://127.0.0.1:3999",
    "null",
    `${APP}, https://app.mellodifai.com`,
  ]) {
    const reply = await send(port, "/rest/v1/songs", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "apikey",
        "access-control-request-private-network": "true",
      },
    });
    expect(reply.status, origin).toBe(403);
    expect(
      Object.keys(reply.headers).filter((name) =>
        name.startsWith("access-control-"),
      ),
      origin,
    ).toEqual([]);
  }
  // Not a browser: a plain OPTIONS gets no CORS grant and stays in the gateway.
  const plain = await send(port, "/rest/v1/songs", { method: "OPTIONS" });
  expect(plain.status).toBe(204);
  expect(plain.headers["access-control-allow-origin"]).toBe(undefined);
  expect(seen).toHaveLength(0);
});

it("puts one CORS policy on responses: the app origin, never the upstream's", async () => {
  const { port } = await stack({
    rest: (_req, res) => {
      res
        .writeHead(200, {
          "access-control-allow-origin": "*",
          "access-control-allow-credentials": "true",
          "access-control-expose-headers": "Content-Range",
          "content-range": "0-0/1",
          vary: "Accept-Encoding",
        })
        .end("[]");
    },
  });
  const allowed = await send(port, "/rest/v1/songs", {
    headers: withKey(ANON, { origin: APP }),
  });
  expect(allowed.status).toBe(200);
  expect(allowed.headers).toMatchObject({
    "access-control-allow-origin": APP,
    "access-control-expose-headers": "*",
    "content-range": "0-0/1",
    vary: "Accept-Encoding, Origin",
  });
  expect(allowed.headers["access-control-allow-credentials"]).toBe(undefined);

  for (const origin of ["http://attacker.invalid", "null", undefined]) {
    const reply = await send(port, "/rest/v1/songs", {
      headers: withKey(ANON, origin ? { origin } : {}),
    });
    // CORS is not access control: the call is served, the page cannot read it.
    expect(reply.status).toBe(200);
    expect(
      Object.keys(reply.headers).filter((name) =>
        name.startsWith("access-control-"),
      ),
    ).toEqual([]);
    expect(reply.headers.vary).toBe("Accept-Encoding, Origin");
  }
  // The app can read the gateway's own refusals.
  const refused = await send(port, "/rest/v1/songs", {
    headers: { origin: APP },
  });
  expect(refused.status).toBe(401);
  expect(refused.headers["access-control-allow-origin"]).toBe(APP);
  expect(refused.headers.vary).toBe("Origin");
});

it("lets any page read a signed object, without credentials", async () => {
  const { port } = await stack({
    storage: (_req, res) => {
      res
        .writeHead(200, {
          "content-type": "image/png",
          "access-control-allow-origin": "http://storage.invalid",
          vary: "Origin",
        })
        .end("png");
    },
  });
  const link = "/storage/v1/object/sign/previews/user-1/cover.png?token=t";
  for (const origin of ["http://attacker.invalid", APP, "null", undefined]) {
    for (const method of ["GET", "HEAD"]) {
      const reply = await send(port, link, {
        method,
        headers: origin ? { origin } : {},
      });
      expect(reply.status).toBe(200);
      expect(reply.headers["access-control-allow-origin"]).toBe("*");
      expect(reply.headers["access-control-expose-headers"]).toBe("*");
      expect(reply.headers["access-control-allow-credentials"]).toBe(undefined);
    }
    if (!origin) continue;
    const preflight = await send(port, link, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "range",
        "access-control-request-private-network": "true",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers).toMatchObject({
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "range",
    });
    expect(preflight.headers["access-control-allow-private-network"]).toBe(
      undefined,
    );
  }
  // Signing a link, or any other method on that path, stays an app-only call.
  const sign = await send(port, link, {
    method: "OPTIONS",
    headers: {
      origin: "http://attacker.invalid",
      "access-control-request-method": "POST",
    },
  });
  expect(sign.status).toBe(403);
  const authenticated = await send(
    port,
    "/storage/v1/object/previews/user-1/cover.png",
    { headers: withKey(ANON, { origin: "http://attacker.invalid" }) },
  );
  expect(authenticated.headers["access-control-allow-origin"]).toBe(undefined);
});

it("drops hop-by-hop headers in both directions", async () => {
  const { port } = await stack({
    rest: (req, res) => {
      res
        .writeHead(200, {
          connection: "x-upstream-hop",
          "x-upstream-hop": "1",
          "keep-alive": "timeout=99",
          "proxy-authenticate": "Basic",
          "x-kept": "yes",
        })
        .end(JSON.stringify({ headers: req.headers }));
    },
  });
  const reply = await send(port, "/rest/v1/songs", {
    method: "POST",
    headers: withKey(ANON, {
      connection: "keep-alive, x-client-hop",
      "x-client-hop": "1",
      "keep-alive": "timeout=99",
      "proxy-authorization": "Basic secret",
      "proxy-connection": "keep-alive",
      te: "trailers",
      trailer: "x-checksum",
      upgrade: "h2c",
      expect: "100-continue",
      prefer: "return=representation",
    }),
    body: "{}",
  });
  expect(reply.status).toBe(200);
  const { headers } = seenBy(reply);
  for (const name of [
    "x-client-hop",
    "keep-alive",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "upgrade",
    "expect",
  ])
    expect(headers[name], name).toBe(undefined);
  expect(headers.prefer).toBe("return=representation");
  expect(reply.headers["x-kept"]).toBe("yes");
  for (const name of ["x-upstream-hop", "proxy-authenticate"])
    expect(reply.headers[name], name).toBe(undefined);
  expect(reply.headers["keep-alive"]).not.toBe("timeout=99");
});

it("refuses ambiguous request framing before any service sees it", async () => {
  const { port, seen } = await stack();
  const head = (lines: string[]) =>
    `${["POST /rest/v1/songs HTTP/1.1", `Host: 127.0.0.1:${port}`, `apikey: ${SERVICE}`, "Connection: close", ...lines].join("\r\n")}\r\n\r\n`;
  const smuggled = `GET /rest/v1/smuggled HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\napikey: ${SERVICE}\r\n\r\n`;
  for (const [name, request] of [
    [
      "length and chunked",
      `${head(["Content-Length: 4", "Transfer-Encoding: chunked"])}0\r\n\r\n${smuggled}`,
    ],
    [
      "chunked and length",
      `${head(["Transfer-Encoding: chunked", "Content-Length: 4"])}0\r\n\r\n${smuggled}`,
    ],
    [
      "two different lengths",
      `${head(["Content-Length: 0", `Content-Length: ${smuggled.length}`])}${smuggled}`,
    ],
    [
      "two equal lengths",
      `${head(["Content-Length: 2", "Content-Length: 2"])}{}`,
    ],
    ["length list", `${head(["Content-Length: 2, 2"])}{}`],
    ["negative length", `${head(["Content-Length: -1"])}`],
    ["signed length", `${head(["Content-Length: +2"])}{}`],
    [
      "chunked not last",
      `${head(["Transfer-Encoding: chunked, gzip"])}0\r\n\r\n`,
    ],
    [
      "stacked encodings",
      `${head(["Transfer-Encoding: gzip, chunked"])}0\r\n\r\n${smuggled}`,
    ],
    [
      "two encodings",
      `${head(["Transfer-Encoding: chunked", "Transfer-Encoding: chunked"])}0\r\n\r\n${smuggled}`,
    ],
    ["unknown encoding", `${head(["Transfer-Encoding: xchunked"])}0\r\n\r\n`],
    ["space before the colon", `${head(["Content-Length : 2"])}{}`],
    ["folded header", `${head(["X-Folded: a", " Content-Length: 2"])}{}`],
  ] as const) {
    expect(statuses(await raw(port, request)), name).toEqual([400]);
  }
  expect(seen).toHaveLength(0);
});

it("keeps a refused request's body from becoming the next request", async () => {
  const { port, seen } = await stack();
  const hidden = `GET /rest/v1/smuggled HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\napikey: ${SERVICE}\r\n\r\n`;
  // No key: the gateway answers 401 without reading the body, on a kept-alive
  // connection. The body must be skipped, not parsed as a second request.
  const reply = await raw(
    port,
    `POST /rest/v1/songs HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: ${hidden.length}\r\n\r\n${hidden}` +
      `GET /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
  );
  expect(statuses(reply)).toEqual([401, 200]);
  expect(seen).toHaveLength(0);
});

it("keeps a chunked body chunked for every method", async () => {
  const { port } = await stack();
  const reply = await raw(
    port,
    `DELETE /storage/v1/object/previews HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\napikey: ${SERVICE}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n` +
      `c\r\n{"prefixes":\r\n9\r\n["a.mp3"]\r\n1\r\n}\r\n0\r\n\r\n`,
  );
  expect(statuses(reply)).toEqual([200]);
  const record = JSON.parse(
    reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1),
  ) as Seen;
  expect(record).toMatchObject({
    method: "DELETE",
    url: "/object/previews",
    body: '{"prefixes":["a.mp3"]}',
  });
  expect(record.headers["transfer-encoding"]).toBe("chunked");
  expect(record.headers["content-length"]).toBe(undefined);
});

it("streams a large upload with its length and with chunks, byte for byte", {
  timeout: 60_000,
}, async () => {
  const received: {
    bytes: number;
    hash: string;
    headers: IncomingHttpHeaders;
  }[] = [];
  const { port } = await stack({
    storage: async (req, res) => {
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of req) {
        hash.update(chunk as Buffer);
        bytes += (chunk as Buffer).length;
      }
      received.push({ bytes, hash: hash.digest("hex"), headers: req.headers });
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"Key":"previews/a.mp4"}');
    },
  });
  const chunk = randomBytes(MIB);
  // Above the largest Storage limit in the repo (100 MiB in config.toml).
  for (const [count, framed] of [
    [112, true],
    [24, false],
  ] as const) {
    const expected = createHash("sha256");
    for (let index = 0; index < count; index++) expected.update(chunk);
    const req = open(port, "/storage/v1/object/previews/user-1/a.mp4", {
      method: "POST",
      headers: withKey(ANON, {
        "content-type": "video/mp4",
        "x-upsert": "true",
        ...(framed ? { "content-length": String(count * MIB) } : {}),
      }),
    });
    const answered = once(req, "response") as Promise<[IncomingMessage]>;
    await stream(req, chunk, count);
    const reply = await collect((await answered)[0]);
    expect(reply.status).toBe(200);
    expect(reply.text).toBe('{"Key":"previews/a.mp4"}');
    const upload = received.at(-1);
    expect(upload?.bytes).toBe(count * MIB);
    expect(upload?.hash).toBe(expected.digest("hex"));
    expect(upload?.headers["content-length"]).toBe(
      framed ? String(count * MIB) : undefined,
    );
    expect(upload?.headers["transfer-encoding"]).toBe(
      framed ? undefined : "chunked",
    );
    expect(upload?.headers["x-upsert"]).toBe("true");
  }
});

it("holds an upload back while the service is not reading, instead of buffering it", {
  timeout: 60_000,
}, async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { port } = await stack({
    storage: async (req, res) => {
      await gate;
      let bytes = 0;
      for await (const chunk of req) bytes += (chunk as Buffer).length;
      res.end(String(bytes));
    },
  });
  const total = 96;
  const chunk = Buffer.alloc(MIB, 7);
  const req = open(port, "/storage/v1/object/previews/user-1/a.mp4", {
    method: "POST",
    headers: withKey(ANON, { "content-length": String(total * MIB) }),
  });
  const sending = stream(req, chunk, total);
  const answered = once(req, "response") as Promise<[IncomingMessage]>;
  await sleep(700);
  // Only what fits in socket and stream buffers has left the client.
  const stalled = req.socket?.bytesWritten ?? Number.POSITIVE_INFINITY;
  expect(stalled).toBeLessThan(24 * MIB);
  release();
  await sending;
  const reply = await collect((await answered)[0]);
  expect(reply.text).toBe(String(total * MIB));
});

it("streams downloads: ranges, conditions, HEAD and empty answers stay as the service sent them", {
  timeout: 60_000,
}, async () => {
  const file = randomBytes(24 * MIB);
  const etag = `"${createHash("sha256").update(file).digest("hex").slice(0, 16)}"`;
  const asked: IncomingHttpHeaders[] = [];
  const { port } = await stack({
    storage: (req, res) => {
      asked.push(req.headers);
      const common = {
        "content-type": "audio/mpeg",
        "accept-ranges": "bytes",
        "cache-control": "max-age=3600",
        "last-modified": "Fri, 13 Nov 2026 08:00:00 GMT",
        etag,
      };
      if (req.method === "DELETE") {
        res.writeHead(204).end();
        return;
      }
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, common).end();
        return;
      }
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
      if (req.headers.range && !range) {
        res.writeHead(416, { "content-range": `bytes */${file.length}` }).end();
        return;
      }
      const start = range ? Number(range[1]) : 0;
      const end = range ? Number(range[2]) : file.length - 1;
      res.writeHead(range ? 206 : 200, {
        ...common,
        "content-length": end - start + 1,
        ...(range
          ? { "content-range": `bytes ${start}-${end}/${file.length}` }
          : {}),
      });
      res.end(
        req.method === "HEAD" ? undefined : file.subarray(start, end + 1),
      );
    },
  });
  const link =
    "/storage/v1/object/sign/previews/user-1/a.mp3?token=signed-token-value";

  const whole = await send(port, link);
  expect(whole.status).toBe(200);
  expect(whole.headers).toMatchObject({
    "content-length": String(file.length),
    "content-type": "audio/mpeg",
    "accept-ranges": "bytes",
    "cache-control": "max-age=3600",
    "last-modified": "Fri, 13 Nov 2026 08:00:00 GMT",
    etag,
  });
  expect(whole.headers["transfer-encoding"]).toBe(undefined);
  expect(whole.body.equals(file)).toBe(true);

  const part = await send(port, link, {
    headers: { range: `bytes=${3 * MIB}-${5 * MIB - 1}`, "if-range": etag },
  });
  expect(part.status).toBe(206);
  expect(part.headers).toMatchObject({
    "content-range": `bytes ${3 * MIB}-${5 * MIB - 1}/${file.length}`,
    "content-length": String(2 * MIB),
  });
  expect(part.body.equals(file.subarray(3 * MIB, 5 * MIB))).toBe(true);
  expect(asked.at(-1)).toMatchObject({
    range: `bytes=${3 * MIB}-${5 * MIB - 1}`,
    "if-range": etag,
  });

  const unsatisfiable = await send(port, link, {
    headers: { range: "bytes=999999999999-" },
  });
  expect(unsatisfiable.status).toBe(416);
  expect(unsatisfiable.headers["content-range"]).toBe(`bytes */${file.length}`);

  const fresh = await send(port, link, {
    headers: {
      "if-none-match": etag,
      "if-modified-since": "Fri, 13 Nov 2026 08:00:00 GMT",
    },
  });
  expect(fresh.status).toBe(304);
  expect(fresh.body).toHaveLength(0);
  expect(fresh.headers.etag).toBe(etag);
  expect(asked.at(-1)?.["if-modified-since"]).toBe(
    "Fri, 13 Nov 2026 08:00:00 GMT",
  );

  const head = await send(port, link, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers["content-length"]).toBe(String(file.length));
  expect(head.body).toHaveLength(0);

  const removed = await send(port, "/storage/v1/object/previews/a.mp3", {
    method: "DELETE",
    headers: withKey(),
  });
  expect(removed.status).toBe(204);
  expect(removed.body).toHaveLength(0);
  expect(removed.headers["content-length"]).toBe(undefined);
  expect(removed.headers["transfer-encoding"]).toBe(undefined);
});

it("holds a download back for a slow reader and closes the service side when the reader leaves", {
  timeout: 60_000,
}, async () => {
  let written = 0;
  const closed = vi.fn();
  const total = 256;
  const { port } = await stack({
    storage: async (_req, res) => {
      res.on("close", closed);
      res.writeHead(200, { "content-type": "video/mp4" });
      const chunk = Buffer.alloc(MIB, 1);
      for (let index = 0; index < total && !res.destroyed; index++) {
        written += chunk.length;
        if (!res.write(chunk))
          await Promise.race([once(res, "drain"), once(res, "close")]);
      }
      if (!res.destroyed) res.end();
    },
  });
  const req = open(
    port,
    "/storage/v1/object/sign/previews/user-1/a.mp4?token=t",
  );
  req.end();
  const [response] = (await once(req, "response")) as [IncomingMessage];
  expect(response.headers["transfer-encoding"]).toBe("chunked");
  await once(response, "data");
  response.pause();
  await sleep(700);
  expect(written).toBeLessThan(48 * MIB);
  expect(closed).not.toHaveBeenCalled();
  req.destroy();
  await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
  expect(written).toBeLessThan(total * MIB);
});

it("relays service errors and events as they are", async () => {
  const disconnected = vi.fn();
  const { port } = await stack({
    rest: (_req, res) => {
      res
        .writeHead(409, {
          "content-type": "application/json; charset=utf-8",
          "proxy-status": "PostgREST; error=23505",
        })
        .end('{"code":"23505","message":"duplicate key value"}');
    },
    auth: (_req, res) => {
      res
        .writeHead(429, {
          "content-type": "application/json",
          "retry-after": "60",
          "x-sb-error-code": "over_email_send_rate_limit",
        })
        .end('{"code":429,"error_code":"over_email_send_rate_limit"}');
    },
    storage: (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: ready\n\n");
      res.on("close", disconnected);
    },
  });
  const conflict = await send(port, "/rest/v1/songs", {
    method: "POST",
    headers: withKey(),
    body: "{}",
  });
  expect(conflict.status).toBe(409);
  expect(conflict.text).toBe(
    '{"code":"23505","message":"duplicate key value"}',
  );
  expect(conflict.headers["content-type"]).toBe(
    "application/json; charset=utf-8",
  );
  expect(conflict.headers["proxy-status"]).toBe("PostgREST; error=23505");
  const limited = await send(port, "/auth/v1/otp", {
    method: "POST",
    headers: withKey(),
    body: "{}",
  });
  expect(limited.status).toBe(429);
  expect(limited.headers["retry-after"]).toBe("60");
  expect(limited.headers["x-sb-error-code"]).toBe("over_email_send_rate_limit");
  expect(limited.text).toBe(
    '{"code":429,"error_code":"over_email_send_rate_limit"}',
  );
  // A response is passed on as it arrives, not when it ends.
  const req = open(port, "/storage/v1/events", { headers: withKey() });
  req.end();
  const [response] = (await once(req, "response")) as [IncomingMessage];
  const [first] = (await once(response, "data")) as [Buffer];
  expect(first.toString()).toBe("data: ready\n\n");
  req.destroy();
  await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
});

it("answers 503 at once when a service is down, and keeps serving the others", async () => {
  const { port, logs } = await stack({ down: "auth" });
  const started = Date.now();
  for (const method of ["GET", "POST"]) {
    const reply = await send(port, "/auth/v1/token?grant_type=password", {
      method,
      headers: withKey(ANON, { origin: APP }),
      ...(method === "POST" ? { body: '{"email":"a@example.test"}' } : {}),
    });
    expect(reply.status).toBe(503);
    expect(JSON.parse(reply.text)).toEqual({ message: "Service unavailable" });
    expect(reply.headers["retry-after"]).toBe("1");
    expect(reply.headers["access-control-allow-origin"]).toBe(APP);
    expect(logs.at(-1)).toMatchObject({
      route: "auth",
      status: 503,
      error: "upstream_down",
    });
  }
  expect(Date.now() - started).toBeLessThan(8_000);
  expect(
    (await send(port, "/rest/v1/songs", { headers: withKey() })).status,
  ).toBe(200);
});

it("answers an upload no service takes, and still reads the rest of it", {
  timeout: 60_000,
}, async () => {
  const { port } = await stack({
    down: "auth",
    storage: (req, res) => {
      // Too large for Storage: it answers on the headers and hangs up.
      res
        .writeHead(413, { "content-type": "application/json" })
        .end('{"statusCode":"413","error":"Payload too large"}');
      setTimeout(() => req.socket.destroy(), 150);
    },
  });
  const upload = open(port, "/storage/v1/object/previews/user-1/a.mp4", {
    method: "POST",
    headers: withKey(ANON, { "content-length": String(96 * MIB) }),
  });
  const answered = once(upload, "response") as Promise<[IncomingMessage]>;
  await stream(upload, Buffer.alloc(MIB, 3), 96);
  const refused = await collect((await answered)[0]);
  expect(refused.status).toBe(413);
  expect(refused.text).toBe('{"statusCode":"413","error":"Payload too large"}');

  // The service is down: the 503 comes at once, the body is still read to its
  // end, and the next request on the same connection is understood.
  const body = "a".repeat(16 * MIB);
  const reply = await raw(
    port,
    `POST /auth/v1/admin/users HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\napikey: ${SERVICE}\r\nContent-Length: ${body.length}\r\n\r\n${body}` +
      `GET /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
  );
  expect(statuses(reply)).toEqual([503, 200]);
});

it("answers 502 when a service breaks off, before or during its answer", async () => {
  const { port, logs } = await stack({
    rest: (req) => {
      req.socket.destroy();
    },
    storage: (_req, res) => {
      res.writeHead(200, { "content-length": "1000" });
      res.write("partial");
      setTimeout(() => res.socket?.destroy(), 50);
    },
  });
  const reply = await send(port, "/rest/v1/songs", { headers: withKey() });
  expect(reply.status).toBe(502);
  expect(JSON.parse(reply.text)).toEqual({ message: "Bad gateway" });
  expect(logs.at(-1)).toMatchObject({ status: 502, error: "upstream_error" });
  // Headers were already relayed: the only honest signal left is a cut.
  const req = open(port, "/storage/v1/object/previews/a.mp3", {
    headers: withKey(),
  });
  req.end();
  const [response] = (await once(req, "response")) as [IncomingMessage];
  expect(response.statusCode).toBe(200);
  await expect(collect(response)).rejects.toThrow();
  // The gateway itself is unharmed.
  expect((await send(port, "/health")).status).toBe(200);
});

it("gives up on a silent service with 504 and on a silent, slow or idle client by closing", async () => {
  const hung = vi.fn();
  const abandoned = vi.fn();
  const { port, logs } = await stack({
    rest: () => hung(),
    storage: (_req, res) => {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.write("first bytes");
    },
    auth: async (_req, res) => {
      res.on("close", abandoned);
      const chunk = Buffer.alloc(MIB, 1);
      while (!res.destroyed)
        if (!res.write(chunk))
          await Promise.race([once(res, "drain"), once(res, "close")]);
    },
    limits: {
      upstreamTimeoutMs: 300,
      idleTimeoutMs: 300,
      headersTimeoutMs: 400,
      requestTimeoutMs: 400,
    },
  });
  let started = Date.now();
  const reply = await send(port, "/rest/v1/rpc/slow", {
    method: "POST",
    headers: withKey(ANON, { origin: APP }),
    body: "{}",
  });
  expect(reply.status).toBe(504);
  expect(JSON.parse(reply.text)).toEqual({ message: "Upstream timed out" });
  expect(reply.headers["access-control-allow-origin"]).toBe(APP);
  expect(hung).toHaveBeenCalledOnce();
  expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(logs.at(-1)).toMatchObject({ status: 504, error: "upstream_timeout" });

  // A service that stalls mid-body: the answer is cut, never left hanging.
  const req = open(port, "/storage/v1/object/previews/a.mp3", {
    headers: withKey(),
  });
  req.end();
  const [response] = (await once(req, "response")) as [IncomingMessage];
  await expect(collect(response)).rejects.toThrow();

  // A client that stops reading an endless answer: the service connection it
  // holds falls silent behind it and is given up the same way.
  const stalled = open(port, "/auth/v1/stream", { headers: withKey() });
  stalled.end();
  const [stream] = (await once(stalled, "response")) as [IncomingMessage];
  await once(stream, "data");
  stream.pause();
  await vi.waitFor(() => expect(abandoned).toHaveBeenCalledOnce(), {
    timeout: 5_000,
  });
  stalled.destroy();

  // A client that finished a request and then just keeps the connection.
  started = Date.now();
  expect(
    statuses(
      await raw(
        port,
        `GET /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
      ),
    ),
  ).toEqual([200]);
  expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  expect(Date.now() - started).toBeLessThan(3_000);

  // A client that connects and sends nothing, or stops mid-headers. Whether
  // its 408 still arrives depends on the race with the close; the cut matters.
  for (const opening of [
    "",
    `GET /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`,
  ]) {
    started = Date.now();
    expect(await raw(port, opening)).toMatch(/^(HTTP\/1\.1 408 |$)/);
    expect(Date.now() - started).toBeLessThan(5_000);
  }

  // A client that drips its headers forever.
  started = Date.now();
  const dripped = await new Promise<string>((resolve, reject) => {
    const socket: Socket = connect(port, "127.0.0.1");
    let text = "";
    const timer = setInterval(() => socket.write("x-drip: 1\r\n"), 50);
    socket.on("connect", () =>
      socket.write(`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`),
    );
    socket.on("data", (chunk) => {
      text += chunk.toString();
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearInterval(timer);
      resolve(text);
    });
    setTimeout(
      () => reject(new Error("The slow client was never cut")),
      10_000,
    ).unref();
  });
  expect(dripped).toMatch(/^(HTTP\/1\.1 408 |$)/);
  expect(Date.now() - started).toBeLessThan(5_000);
});

it("enforces its size, method and connection limits", async () => {
  const { port, ports, seen } = await stack({
    limits: { maxUrlBytes: 512, maxHeaderBytes: 4096, maxConnections: 2 },
  });
  const long = await send(port, `/rest/v1/songs?id=in.(${"1,".repeat(300)}1)`, {
    headers: withKey(),
  });
  expect(long.status).toBe(414);
  expect(
    (
      await send(port, `/rest/v1/songs?id=in.(${"1,".repeat(200)}1)`, {
        headers: withKey(),
      })
    ).status,
  ).toBe(200);
  expect(
    statuses(
      await raw(
        port,
        `GET /rest/v1/songs HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\napikey: ${SERVICE}\r\nx-big: ${"b".repeat(8192)}\r\nConnection: close\r\n\r\n`,
      ),
    ),
  ).toEqual([431]);
  for (const method of ["TRACE", "PROPFIND", "PURGE"])
    expect(
      statuses(
        await raw(
          port,
          `${method} /rest/v1/songs HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\napikey: ${SERVICE}\r\nConnection: close\r\n\r\n`,
        ),
      ),
      method,
    ).toEqual([405]);
  // No tunnels: a CONNECT is closed without a word.
  expect(
    await raw(
      port,
      `CONNECT 127.0.0.1:${ports.rest} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\napikey: ${SERVICE}\r\n\r\n`,
    ).catch(() => ""),
  ).toBe("");
  expect(seen).toHaveLength(1);

  // Two idle sockets fill the gateway; the third connection is dropped.
  const held = await Promise.all(
    [0, 1].map(async () => {
      const socket = connect(port, "127.0.0.1");
      await once(socket, "connect");
      return socket;
    }),
  );
  await sleep(100);
  const health = `GET /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`;
  expect(await raw(port, health).catch(() => "")).toBe("");
  for (const socket of held) socket.destroy();
  await sleep(100);
  expect(statuses(await raw(port, health))).toEqual([200]);
});

it("answers every upgrade with 404: there is no Realtime", async () => {
  const { port, seen, logs } = await stack();
  for (const path of [
    `/realtime/v1/websocket?apikey=${ANON}&vsn=1.0.0`,
    "/rest/v1/songs",
    "/storage/v1/upload/resumable",
    "/health",
  ]) {
    const req = open(port, path, {
      headers: withKey(SERVICE, {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      }),
    });
    req.end();
    const upgraded = vi.fn();
    req.on("upgrade", upgraded);
    const [response] = (await once(req, "response")) as [IncomingMessage];
    expect(response.statusCode, path).toBe(404);
    expect((await collect(response)).body).toHaveLength(0);
    expect(upgraded).not.toHaveBeenCalled();
    expect(logs.at(-1)).toMatchObject({ status: 404, error: "upgrade" });
  }
  expect(seen).toHaveLength(0);
  expect(JSON.stringify(logs)).not.toContain(ANON);
});

it("reports its own health without a key and without touching a service", async () => {
  const { port, seen, logs } = await stack({ down: "rest" });
  const reply = await send(port, "/health");
  expect(reply.status).toBe(200);
  expect(JSON.parse(reply.text)).toEqual({ status: "ok" });
  expect(reply.headers["cache-control"]).toBe("no-store");
  const head = await send(port, "/health", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.body).toHaveLength(0);
  expect((await send(port, "/health?deep=1")).status).toBe(200);
  const post = await send(port, "/health", { method: "POST" });
  expect(post.status).toBe(405);
  expect(post.headers.allow).toBe("GET, HEAD");
  expect(seen).toHaveLength(0);
  expect(logs.at(0)).toMatchObject({
    method: "GET",
    route: "health",
    path: "/health",
    status: 200,
    key: "none",
  });
});

it("logs one line per request and never a key, token, cookie or query", async () => {
  const lines: string[] = [];
  const { port, logs, config } = await stack();
  const { log: _collector, ...silent } = config;
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
  const printed = await listen(createGateway(silent));
  const secrets = [
    ANON,
    SERVICE,
    USER_JWT,
    "cookie-secret",
    "signed-token-value",
    "magic-token",
    "wrong-key-value",
    "refresh-token-value",
    "query-secret",
  ];
  for (const target of [port, printed]) {
    await send(target, "/rest/v1/songs?select=*&secret=eq.query-secret", {
      headers: withKey(ANON, { cookie: "sb-session=cookie-secret" }),
    });
    await send(target, "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: withKey(SERVICE),
      body: '{"refresh_token":"refresh-token-value"}',
    });
    await send(target, "/rest/v1/songs", {
      headers: { authorization: `Bearer ${SERVICE}` },
    });
    await send(target, "/rest/v1/songs", {
      headers: { apikey: "wrong-key-value" },
    });
    await send(target, "/rest/v1/songs", {
      headers: { authorization: `Bearer ${USER_JWT}` },
    });
    await send(target, "/auth/v1/verify?token=magic-token&type=magiclink");
    await send(
      target,
      "/storage/v1/object/sign/previews/a.mp3?token=signed-token-value",
    );
    await send(target, `/realtime/v1/websocket?apikey=${ANON}`);
    await send(target, `/rest/v1/%zz?apikey=${SERVICE}`);
    await send(target, "/rest/v1/songs", {
      method: "OPTIONS",
      headers: { origin: APP, "access-control-request-method": "GET" },
    });
  }
  await vi.waitFor(() => {
    expect(logs).toHaveLength(10);
    expect(lines.filter((line) => line.includes('"route"'))).toHaveLength(10);
  });
  write.mockRestore();
  const printedEntries = lines
    .filter((line) => line.includes('"route"'))
    .map((line) => {
      expect(line.endsWith("\n")).toBe(true);
      return JSON.parse(line) as GatewayLogEntry;
    });
  for (const text of [JSON.stringify(logs), lines.join("")]) {
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/[?=]|Bearer|cookie/i);
  }
  const shape = (entry: GatewayLogEntry) => [
    entry.method,
    entry.route,
    entry.path,
    entry.status,
    entry.key,
    entry.error,
  ];
  expect(printedEntries.map(shape)).toEqual(logs.map(shape));
  expect(logs.map(shape)).toEqual([
    ["GET", "rest", "/rest/v1/songs", 200, "anon", undefined],
    ["POST", "auth", "/auth/v1/token", 200, "service", undefined],
    ["GET", "rest", "/rest/v1/songs", 200, "service", undefined],
    ["GET", "rest", "/rest/v1/songs", 401, "none", "apikey_wrong"],
    ["GET", "rest", "/rest/v1/songs", 401, "none", "apikey_missing"],
    ["GET", "auth", "/auth/v1/verify", 200, "public", undefined],
    [
      "GET",
      "storage",
      "/storage/v1/object/sign/previews/a.mp3",
      200,
      "public",
      undefined,
    ],
    ["GET", "none", "/realtime/v1/websocket", 404, "none", "route"],
    ["GET", "none", "/rest/v1/%zz", 400, "none", "target"],
    ["OPTIONS", "rest", "/rest/v1/songs", 204, "none", undefined],
  ]);
  for (const entry of logs) {
    expect(Number.isNaN(Date.parse(entry.time))).toBe(false);
    expect(entry.ms).toBeGreaterThanOrEqual(0);
    expect(Object.keys(entry).sort()).toEqual(
      [
        "time",
        "method",
        "route",
        "path",
        "status",
        "ms",
        "key",
        ...(entry.error ? ["error"] : []),
      ].sort(),
    );
  }
});

it("reuses service connections and opens a new one when a service closed the idle one", async () => {
  const sockets = new Set<Socket>();
  const { port } = await stack({
    rest: (req, res) => {
      sockets.add(req.socket);
      res.end("[]");
    },
  });
  for (let index = 0; index < 5; index++)
    expect(
      (await send(port, "/rest/v1/songs", { headers: withKey() })).status,
    ).toBe(200);
  expect(sockets.size).toBe(1);
  // A restarted or impatient service drops its idle connections.
  for (const socket of sockets) socket.destroy();
  await sleep(100);
  for (let index = 0; index < 5; index++)
    expect(
      (
        await send(port, "/rest/v1/songs", {
          method: "POST",
          headers: withKey(),
          body: "{}",
        })
      ).status,
    ).toBe(200);
  expect(sockets.size).toBe(2);
});

function fixtureDir(): string {
  mkdirSync(tempBase, { recursive: true });
  const dir = mkdtempSync(join(tempBase, "gateway-test-"));
  closers.push(() => {
    // Only ever remove the directory this test made.
    if (basename(dir).startsWith("gateway-test-"))
      rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

it("reads its config file without ever quoting it in an error", () => {
  const dir = fixtureDir();
  const file = join(dir, "gateway.json");
  const config = {
    host: "127.0.0.1",
    port: 45621,
    upstreams: {
      auth: "http://127.0.0.1:45620",
      rest: "http://127.0.0.1:45628",
      storage: "http://127.0.0.1:45629",
    },
    keys: { anon: ANON, service: SERVICE },
    appOrigins: [APP],
  };
  // PowerShell writes a byte-order mark; it is not part of the JSON.
  writeFileSync(file, `\uFEFF${JSON.stringify(config)}`);
  expect(loadGatewayConfig(file)).toEqual({ ...config, limits: {} });

  const failure = (path: string | undefined) => {
    try {
      loadGatewayConfig(path);
    } catch (error) {
      return (error as Error).message;
    }
    return "";
  };
  expect(failure(undefined)).toMatch(
    /MDF_GATEWAY_CONFIG must be the absolute path/,
  );
  expect(failure("")).toMatch(/MDF_GATEWAY_CONFIG must be the absolute path/);
  expect(failure("gateway.json")).toMatch(
    /MDF_GATEWAY_CONFIG must be the absolute path/,
  );
  expect(failure(join(dir, "missing.json"))).toBe(
    "Cannot read the gateway config file (ENOENT)",
  );
  writeFileSync(file, JSON.stringify(config).replace('"keys"', "keys"));
  expect(failure(file)).toBe("The gateway config file is not valid JSON");
  writeFileSync(
    file,
    JSON.stringify({ ...config, keys: { anon: ANON, service: ANON } }),
  );
  expect(failure(file)).toBe(
    "Invalid gateway config: keys.anon and keys.service match",
  );
  writeFileSync(file, JSON.stringify({ ...config, host: "0.0.0.0" }));
  expect(failure(file)).toBe(
    'Invalid gateway config: host must be "127.0.0.1"',
  );
});

function launch(configFile: string | undefined) {
  const ops = fileURLToPath(new URL("../../", import.meta.url));
  const { MDF_GATEWAY_CONFIG: _inherited, ...env } = process.env;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(ops, "native-gateway.ts")],
    {
      cwd: ops,
      env: {
        ...env,
        ...(configFile ? { MDF_GATEWAY_CONFIG: configFile } : {}),
        // A lenient parser asked for process-wide must not reach the gateway.
        NODE_OPTIONS: "--insecure-http-parser",
        // tsx keeps its transform cache in the temp directory: not on C:.
        TEMP: tempBase,
        TMP: tempBase,
        TMPDIR: tempBase,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  closers.push(() => {
    child.kill();
  });
  const output = { out: "", err: "" };
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    output.out += chunk;
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    output.err += chunk;
  });
  // Not "close": Node never emits it after the parent disconnects the channel.
  const exited = once(child, "exit") as Promise<[number | null]>;
  return { child, output, exited };
}

it("runs as a process: listens on loopback, serves, and stops cleanly when its supervisor lets go", {
  timeout: 60_000,
}, async () => {
  const { ports, seen } = await stack();
  const file = join(fixtureDir(), "gateway.json");
  writeFileSync(
    file,
    JSON.stringify({
      host: "127.0.0.1",
      port: 0,
      upstreams: {
        auth: `http://127.0.0.1:${ports.auth}`,
        rest: `http://127.0.0.1:${ports.rest}`,
        storage: `http://127.0.0.1:${ports.storage}`,
      },
      keys: { anon: ANON, service: SERVICE },
      appOrigins: [APP],
    }),
  );
  const { child, output, exited } = launch(file);
  const events = () =>
    output.out
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  await vi.waitFor(
    () => expect(events().some((e) => e.event === "listening")).toBe(true),
    { timeout: 30_000, interval: 50 },
  );
  const listening = events().find((e) => e.event === "listening");
  expect(listening?.host).toBe("127.0.0.1");
  const port = Number(listening?.port);
  expect((await send(port, "/health")).status).toBe(200);
  const reply = await send(port, "/rest/v1/songs?secret=eq.query-secret", {
    headers: withKey(SERVICE, { cookie: "sb-session=cookie-secret" }),
  });
  expect(reply.status).toBe(200);
  expect(seenBy(reply)).toMatchObject({
    name: "rest",
    url: "/songs?secret=eq.query-secret",
  });
  expect((await send(port, "/rest/v1/songs")).status).toBe(401);
  // Started with --insecure-http-parser, it still refuses ambiguous framing.
  expect(
    statuses(
      await raw(
        port,
        `POST /rest/v1/songs HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\napikey: ${SERVICE}\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
      ),
    ),
  ).toEqual([400]);
  expect(seen).toHaveLength(1);

  child.disconnect();
  expect((await exited)[0]).toBe(0);
  // The last lines can still be in the pipe when the exit is reported.
  await vi.waitFor(() =>
    expect(events().map((e) => e.event ?? e.route)).toEqual([
      "listening",
      "health",
      "rest",
      "rest",
      "stopping",
      "stopped",
    ]),
  );
  expect(events().find((e) => e.event === "stopping")?.reason).toBe(
    "disconnect",
  );
  expect(output.err).toBe("");
  for (const secret of [
    ANON,
    SERVICE,
    USER_JWT,
    "cookie-secret",
    "query-secret",
  ])
    expect(output.out).not.toContain(secret);
  await expect(send(port, "/health")).rejects.toThrow();
});

it("stops as a process, instead of crashing or lingering, when its log pipe breaks", {
  timeout: 60_000,
}, async () => {
  const { ports } = await stack();
  const file = join(fixtureDir(), "gateway.json");
  writeFileSync(
    file,
    JSON.stringify({
      host: "127.0.0.1",
      port: 0,
      upstreams: {
        auth: `http://127.0.0.1:${ports.auth}`,
        rest: `http://127.0.0.1:${ports.rest}`,
        storage: `http://127.0.0.1:${ports.storage}`,
      },
      keys: { anon: ANON, service: SERVICE },
      appOrigins: [APP],
    }),
  );
  const { child, output, exited } = launch(file);
  await vi.waitFor(() => expect(output.out).toContain('"listening"'), {
    timeout: 30_000,
    interval: 50,
  });
  const port = Number(
    (JSON.parse(output.out.split("\n")[0] ?? "") as { port: number }).port,
  );
  // What a supervisor that died leaves behind: nobody reads the log any more.
  child.stdout?.destroy();
  expect((await send(port, "/health")).status).toBe(200);
  expect((await exited)[0]).toBe(0);
  expect(output.err).toBe("");
});

it("refuses to start as a process without a usable config, and says why without the file's text", {
  timeout: 60_000,
}, async () => {
  const file = join(fixtureDir(), "gateway.json");
  writeFileSync(file, `{"keys":{"service":"${SERVICE}"},`);
  for (const [configFile, message] of [
    [undefined, /MDF_GATEWAY_CONFIG must be the absolute path/],
    [file, /^The gateway config file is not valid JSON\r?\n$/],
  ] as const) {
    const { output, exited } = launch(configFile);
    expect((await exited)[0]).toBe(1);
    await vi.waitFor(() => expect(output.err).toMatch(message));
    expect(output.out).toBe("");
    expect(output.err + output.out).not.toContain(SERVICE);
  }
});
