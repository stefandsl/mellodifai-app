import { createHash, timingSafeEqual } from "node:crypto";
import {
  Agent,
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  request,
  type Server,
  type ServerResponse,
} from "node:http";

/** Every limit is optional in the config file; these are the defaults. */
export interface GatewayLimits {
  /** Largest request line plus headers, in bytes (431 above it). */
  maxHeaderBytes: number;
  /** Longest request target, path plus query, in bytes (414 above it). */
  maxUrlBytes: number;
  /** Client sockets served at once; further connections are dropped. */
  maxConnections: number;
  /** Time a client has to send its complete request headers. */
  headersTimeoutMs: number;
  /** Time a client has to send its complete request, body included. */
  requestTimeoutMs: number;
  /** Time a kept-alive client connection may idle between two requests. */
  idleTimeoutMs: number;
  /**
   * Silence on an upstream socket (connect, headers or body) before the
   * request is given up: 504, or a cut once the answer has started. A client
   * that stops reading silences the upstream too and ends the same way.
   */
  upstreamTimeoutMs: number;
}

export const DEFAULT_GATEWAY_LIMITS: Readonly<GatewayLimits> = {
  maxHeaderBytes: 32 * 1024,
  maxUrlBytes: 8 * 1024,
  maxConnections: 512,
  headersTimeoutMs: 15_000,
  requestTimeoutMs: 300_000,
  idleTimeoutMs: 60_000,
  upstreamTimeoutMs: 60_000,
};

/** One line per finished request. It never carries a header, key or query. */
export interface GatewayLogEntry {
  time: string;
  method: string;
  route: "auth" | "rest" | "storage" | "health" | "none";
  /** Request path without its query string, cut at 256 characters. */
  path: string;
  /** 0 when the client left before any response started. */
  status: number;
  ms: number;
  /** Which credential opened the route; "public" is a keyless public route. */
  key: "anon" | "service" | "public" | "none";
  /** Why the gateway itself answered or cut the request. */
  error?: string;
}

export interface GatewayConfig {
  host: "127.0.0.1";
  /** 0 asks the system for a free port (tests). */
  port: number;
  /** Loopback service origins, exactly "http://127.0.0.1:<port>". */
  upstreams: { auth: string; rest: string; storage: string };
  /** Accepted apikey values. */
  keys: { anon: string; service: string };
  /** Origins allowed by CORS on non-public routes, e.g. "http://127.0.0.1:3000". */
  appOrigins: string[];
  limits?: Partial<GatewayLimits>;
  /** Defaults to one JSON line per request on stdout. Not part of the file. */
  log?: (entry: GatewayLogEntry) => void;
}

const ROUTES = {
  auth: "/auth/v1",
  rest: "/rest/v1",
  storage: "/storage/v1",
} as const;
type RouteName = keyof typeof ROUTES;
const ROUTE_NAMES = Object.keys(ROUTES) as RouteName[];

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
// Headers an upstream (or SQL reading request.headers) could take for the
// caller's address, host or identity. The gateway sets its own x-forwarded-*.
const IDENTITY_HEADERS = new Set([
  "forwarded",
  "x-real-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "true-client-ip",
  "cf-connecting-ip",
  "sb-forwarded-for",
  "x-original-url",
  "x-rewrite-url",
  "x-original-host",
  "x-credential-identifier",
  "x-anonymous-consumer",
]);
const IDENTITY_PREFIXES = ["x-forwarded-", "x-consumer-"];
const HEADER_LIST = /^[\w!#$%&'*+.^`|~-]+(?:\s*,\s*[\w!#$%&'*+.^`|~-]+)*$/;
// Idle upstream sockets are dropped before any upstream's own keep-alive
// timeout can close them under a new request.
const UPSTREAM_FREE_SOCKET_MS = 4_000;
const PREFLIGHT_MAX_AGE_S = "600";

function invalid(message: string): never {
  throw new Error(`Invalid gateway config: ${message}`);
}

function fields(
  value: unknown,
  name: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(`${name} must be an object`);
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra !== undefined)
    invalid(`${name} has an unknown field ${JSON.stringify(extra)}`);
  return value as Record<string, unknown>;
}

/** The URL of a string that is exactly an origin: no path, query or login. */
function exactOrigin(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.origin === value ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks a config read from the private JSON file. Messages name the field at
 * fault and never repeat a value, so a rejected file cannot leak a key.
 */
export function parseGatewayConfig(value: unknown): GatewayConfig {
  const root = fields(value, "config", [
    "host",
    "port",
    "upstreams",
    "keys",
    "appOrigins",
    "limits",
    "log",
  ]);
  if (root.host !== "127.0.0.1") invalid('host must be "127.0.0.1"');
  const port = root.port;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  )
    invalid("port must be an integer from 0 to 65535");

  const rawUpstreams = fields(root.upstreams, "upstreams", ROUTE_NAMES);
  const upstream = (name: RouteName): string => {
    const url = exactOrigin(rawUpstreams[name]);
    if (
      url?.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port === "" ||
      Number(url.port) === port
    )
      invalid(
        `upstreams.${name} must be http://127.0.0.1:<port>, not the gateway port`,
      );
    return url.origin;
  };
  const upstreams = {
    auth: upstream("auth"),
    rest: upstream("rest"),
    storage: upstream("storage"),
  };
  if (new Set(Object.values(upstreams)).size !== ROUTE_NAMES.length)
    invalid("upstreams must be three different services");

  const rawKeys = fields(root.keys, "keys", ["anon", "service"]);
  const key = (name: "anon" | "service"): string => {
    const text = rawKeys[name];
    if (typeof text !== "string" || !/^[\x21-\x7e]{32,}$/.test(text))
      invalid(`keys.${name} must be at least 32 visible ASCII characters`);
    return text;
  };
  const keys = { anon: key("anon"), service: key("service") };
  if (keys.anon === keys.service) invalid("keys.anon and keys.service match");

  if (!Array.isArray(root.appOrigins)) invalid("appOrigins must be an array");
  const appOrigins = root.appOrigins.map((origin: unknown, index) => {
    const url = exactOrigin(origin);
    if (url?.protocol !== "http:" && url?.protocol !== "https:")
      invalid(`appOrigins[${index}] must be an origin like http://host:port`);
    return url.origin;
  });

  const limitNames = Object.keys(
    DEFAULT_GATEWAY_LIMITS,
  ) as (keyof GatewayLimits)[];
  const limits: Partial<GatewayLimits> = {};
  if (root.limits !== undefined) {
    const rawLimits = fields(root.limits, "limits", limitNames);
    for (const name of limitNames) {
      const limit = rawLimits[name];
      if (limit === undefined) continue;
      if (
        typeof limit !== "number" ||
        !Number.isSafeInteger(limit) ||
        limit < 1
      )
        invalid(`limits.${name} must be a positive integer`);
      limits[name] = limit;
    }
  }
  const merged = { ...DEFAULT_GATEWAY_LIMITS, ...limits };
  if (merged.headersTimeoutMs > merged.requestTimeoutMs)
    invalid("limits.headersTimeoutMs must not exceed limits.requestTimeoutMs");

  if (root.log !== undefined && typeof root.log !== "function")
    invalid("log must be a function");
  return {
    host: "127.0.0.1",
    port,
    upstreams,
    keys,
    appOrigins,
    limits,
    ...(root.log ? { log: root.log as (entry: GatewayLogEntry) => void } : {}),
  };
}

function endToEndHeaders(source: IncomingHttpHeaders): IncomingHttpHeaders {
  const headers = { ...source };
  for (const name of [
    ...(source.connection ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase()),
    ...HOP_BY_HOP,
  ])
    delete headers[name];
  return headers;
}

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Splits an origin-form request target. The gateway decides routes and public
 * access from the path, so it refuses every path an upstream could read
 * differently: dot segments, empty segments, encoded separators, controls.
 */
function splitTarget(
  target: string,
): { path: string; query: string } | undefined {
  if (!/^\/[\x21-\x7e]*$/.test(target) || target.includes("#"))
    return undefined;
  const mark = target.indexOf("?");
  const path = mark === -1 ? target : target.slice(0, mark);
  const segments = path.split("/").slice(1);
  for (const [index, segment] of segments.entries()) {
    // Only a trailing slash may leave a segment empty.
    if (segment === "") {
      if (index !== segments.length - 1) return undefined;
      continue;
    }
    if (/%(?![0-9a-fA-F]{2})/.test(segment)) return undefined;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      /[\\/]/.test(decoded) ||
      hasControlCharacter(decoded)
    )
      return undefined;
  }
  return { path, query: mark === -1 ? "" : target.slice(mark) };
}

function matchRoute(
  path: string,
): { route: RouteName; rest: string } | undefined {
  for (const route of ROUTE_NAMES) {
    const prefix = ROUTES[route];
    if (path === prefix || path.startsWith(`${prefix}/`))
      return { route, rest: path.slice(prefix.length) || "/" };
  }
  return undefined;
}

/** A playback link: Storage checks the token, so no apikey is asked. */
function isSignedObject(
  route: RouteName,
  method: string,
  rest: string,
  query: string,
): boolean {
  const prefix = "/object/sign/";
  if (
    route !== "storage" ||
    (method !== "GET" && method !== "HEAD") ||
    !rest.startsWith(prefix)
  )
    return false;
  const [bucket, object] = rest.slice(prefix.length).split("/");
  return Boolean(
    bucket && object && new URLSearchParams(query.slice(1)).get("token"),
  );
}

function addVary(existing: string | undefined, name: string): string {
  const names = (existing ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (
    !names.includes("*") &&
    !names.some((part) => part.toLowerCase() === name.toLowerCase())
  )
    names.push(name);
  return names.join(", ");
}

/**
 * The API gateway of the native runtime: what Kong is to the Docker stack.
 * It only forwards /auth/v1, /rest/v1 and /storage/v1 to their loopback
 * services. The caller listens: `createGateway(config).listen(port, host)`.
 */
export function createGateway(config: GatewayConfig): Server {
  const settings = parseGatewayConfig(config);
  const limits = { ...DEFAULT_GATEWAY_LIMITS, ...settings.limits };
  const appOrigins = new Set(settings.appOrigins);
  const upstreams = Object.fromEntries(
    ROUTE_NAMES.map((route) => [route, new URL(settings.upstreams[route])]),
  ) as Record<RouteName, URL>;
  const log =
    settings.log ??
    ((entry: GatewayLogEntry) => {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    });
  const digest = (text: string) => createHash("sha256").update(text).digest();
  const anonDigest = digest(settings.keys.anon);
  const serviceDigest = digest(settings.keys.service);
  const agent = new Agent({
    keepAlive: true,
    maxFreeSockets: 64,
    timeout: UPSTREAM_FREE_SOCKET_MS,
  });

  /** Compares against both keys, in constant time, whatever the input. */
  function keyKind(candidate: string): "anon" | "service" | undefined {
    const hashed = digest(candidate);
    const anon = timingSafeEqual(hashed, anonDigest);
    const service = timingSafeEqual(hashed, serviceDigest);
    return service ? "service" : anon ? "anon" : undefined;
  }

  /**
   * Kong's key-auth rule: the `apikey` header decides when it is present.
   * Without it, a bearer token that is itself a key counts, which is what
   * supabase-js sends for a client with no user session.
   */
  function credential(
    headers: IncomingHttpHeaders,
  ): "anon" | "service" | "missing" | "wrong" {
    const apikey = headers.apikey;
    if (apikey !== undefined)
      return (typeof apikey === "string" && keyKind(apikey)) || "wrong";
    const bearer = /^Bearer +(\S+)$/i.exec(headers.authorization ?? "")?.[1];
    return (bearer !== undefined && keyKind(bearer)) || "missing";
  }

  function corsHeaders(
    origin: string | undefined,
    signedObject: boolean,
  ): Record<string, string> {
    // Playback links are fetched anonymously from any page (canvas reads after
    // the app's /media redirect); the token in the link is the only credential.
    if (signedObject)
      return {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "*",
      };
    if (origin !== undefined && appOrigins.has(origin))
      return {
        "access-control-allow-origin": origin,
        "access-control-expose-headers": "*",
        vary: "Origin",
      };
    return { vary: "Origin" };
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now();
    const method = req.method ?? "";
    const target = req.url ?? "";
    const entry: Pick<GatewayLogEntry, "route" | "key" | "error"> = {
      route: "none",
      key: "none",
    };
    res.on("close", () => {
      log({
        time: new Date(started).toISOString(),
        method,
        route: entry.route,
        path: (target.split("?", 1)[0] ?? "").slice(0, 256),
        status: res.headersSent ? res.statusCode : 0,
        ms: Date.now() - started,
        key: entry.key,
        ...(entry.error ? { error: entry.error } : {}),
      });
    });
    const answer = (
      status: number,
      error: string,
      message: string,
      headers: Record<string, string> = {},
    ) => {
      entry.error = error;
      const body = JSON.stringify({ message });
      res
        .writeHead(status, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        })
        .end(method === "HEAD" ? undefined : body);
    };

    // A page on another site can aim a rebound DNS name at this port; only
    // the loopback names the app itself uses are served.
    const host = req.headers.host;
    const port = req.socket.localPort;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
      return answer(421, "host", "Misdirected request");
    if (target.length > limits.maxUrlBytes)
      return answer(414, "url_too_long", "Request target too long");
    const split = splitTarget(target);
    if (!split) return answer(400, "target", "Invalid request target");

    if (split.path === "/health") {
      entry.route = "health";
      if (method !== "GET" && method !== "HEAD")
        return answer(405, "method", "Method not allowed", {
          allow: "GET, HEAD",
        });
      const body = JSON.stringify({ status: "ok" });
      res
        .writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
        })
        .end(method === "HEAD" ? undefined : body);
      return;
    }
    const matched = matchRoute(split.path);
    if (!matched) return answer(404, "route", "Not found");
    const { route, rest } = matched;
    entry.route = route;
    if (!METHODS.includes(method))
      return answer(405, "method", "Method not allowed", {
        allow: METHODS.join(", "),
      });

    const origin = req.headers.origin;
    const signedObject = isSignedObject(
      route,
      method === "OPTIONS"
        ? (req.headers["access-control-request-method"] ?? "")
        : method,
      rest,
      split.query,
    );
    const cors = corsHeaders(origin, signedObject);

    // Preflights carry no key and are answered here, never by an upstream.
    if (method === "OPTIONS") {
      if (origin !== undefined && !cors["access-control-allow-origin"])
        return answer(403, "origin", "Origin not allowed", cors);
      const requested = req.headers["access-control-request-headers"];
      res
        .writeHead(204, {
          ...cors,
          ...(origin !== undefined
            ? {
                "access-control-allow-methods": signedObject
                  ? "GET, HEAD, OPTIONS"
                  : METHODS.join(", "),
                "access-control-max-age": PREFLIGHT_MAX_AGE_S,
                // Only the app's own origins get here, so every header their
                // client asks for is allowed, as Kong did.
                ...(requested !== undefined &&
                requested.length <= 2048 &&
                HEADER_LIST.test(requested)
                  ? { "access-control-allow-headers": requested }
                  : {}),
                // Chrome asks this before a public page may call loopback.
                ...(!signedObject &&
                req.headers["access-control-request-private-network"] === "true"
                  ? { "access-control-allow-private-network": "true" }
                  : {}),
              }
            : { allow: METHODS.join(", ") }),
        })
        .end();
      return;
    }

    // Two routes are opened by a token in the link instead of a key: the
    // magic-link navigation and signed playback. The upstream checks the token.
    if (
      signedObject ||
      (route === "auth" && method === "GET" && rest === "/verify")
    )
      entry.key = "public";
    else {
      const found = credential(req.headers);
      if (found === "missing" || found === "wrong")
        return answer(
          401,
          found === "missing" ? "apikey_missing" : "apikey_wrong",
          found === "missing"
            ? "No API key found in request"
            : "Invalid authentication credentials",
          { ...cors, "www-authenticate": 'Key realm="mellodifai"' },
        );
      entry.key = found;
    }

    const upstream = upstreams[route];
    const headers: OutgoingHttpHeaders = endToEndHeaders(req.headers);
    for (const name of Object.keys(headers))
      if (
        IDENTITY_HEADERS.has(name) ||
        IDENTITY_PREFIXES.some((prefix) => name.startsWith(prefix))
      )
        delete headers[name];
    // Node has already answered `Expect: 100-continue` for this hop.
    delete headers.expect;
    // PostgREST shows request headers to SQL; like Kong, keep the key from it.
    if (route === "rest") delete headers.apikey;
    headers.host = upstream.host;
    headers["x-forwarded-for"] = req.socket.remoteAddress ?? "127.0.0.1";
    headers["x-forwarded-proto"] = "http";
    headers["x-forwarded-host"] = host;
    headers["x-forwarded-port"] = String(port);
    headers["x-forwarded-prefix"] = ROUTES[route];
    // Keep the client's framing: a length stays a length, and a chunked body
    // stays chunked for every method instead of being sent unframed.
    if (req.headers["transfer-encoding"] !== undefined) {
      delete headers["content-length"];
      headers["transfer-encoding"] = "chunked";
    }

    let responded = false;
    let timedOut = false;
    const outgoing = request({
      agent,
      host: upstream.hostname,
      port: upstream.port,
      method,
      path: rest + split.query,
      headers,
      timeout: limits.upstreamTimeoutMs,
      insecureHTTPParser: false,
    });
    // Whatever stops the upstream, keep reading the client so its connection
    // stays in step for the answer and for the next request.
    const drain = () => {
      req.unpipe(outgoing);
      req.resume();
    };
    outgoing.on("timeout", () => {
      timedOut = true;
      outgoing.destroy(new Error("Upstream timed out"));
    });
    outgoing.on("response", (incoming) => {
      responded = true;
      const reply = endToEndHeaders(incoming.headers);
      // One CORS policy: the gateway's. Upstream copies would double headers.
      for (const name of Object.keys(reply))
        if (name.startsWith("access-control-")) delete reply[name];
      const { vary, ...allow } = cors;
      Object.assign(reply, allow);
      if (vary) reply.vary = addVary(reply.vary, vary);
      incoming.on("error", () => res.destroy());
      incoming.on("close", () => {
        if (!incoming.complete) res.destroy();
        drain();
      });
      try {
        res.writeHead(incoming.statusCode ?? 502, reply);
      } catch {
        incoming.destroy();
        return answer(502, "upstream_reply", "Bad gateway", cors);
      }
      incoming.pipe(res);
    });
    outgoing.on("error", (error: NodeJS.ErrnoException) => {
      drain();
      // An upstream that answered and then hung up on the request body is
      // reported by its response stream, not here.
      if (responded) return;
      if (res.headersSent || res.destroyed) {
        res.destroy();
        return;
      }
      if (timedOut) answer(504, "upstream_timeout", "Upstream timed out", cors);
      else if (error.code === "ECONNREFUSED")
        answer(503, "upstream_down", "Service unavailable", {
          ...cors,
          "retry-after": "1",
        });
      else answer(502, "upstream_error", "Bad gateway", cors);
    });
    req.on("error", () => outgoing.destroy());
    res.on("close", () => outgoing.destroy());
    req.pipe(outgoing);
  }

  const server = createServer(
    {
      // Node's strict parser is the guard against request smuggling: it
      // refuses a length next to an encoding, repeated or malformed lengths
      // and every encoding but a single "chunked". A process-wide
      // --insecure-http-parser must not switch that off here.
      insecureHTTPParser: false,
      maxHeaderSize: limits.maxHeaderBytes,
      keepAliveTimeout: limits.idleTimeoutMs,
      // Both run from the moment a client connects, so a connection that
      // never sends a byte is closed as well.
      headersTimeout: limits.headersTimeoutMs,
      requestTimeout: limits.requestTimeoutMs,
      // Node enforces the two timeouts above only this often.
      connectionsCheckingInterval: Math.min(
        30_000,
        Math.ceil(limits.headersTimeoutMs / 2),
      ),
    },
    (req, res) => {
      try {
        handle(req, res);
      } catch {
        // A request Node cannot re-send (a header or path it rejects).
        if (res.headersSent) res.destroy();
        else res.writeHead(400, { "content-length": 0 }).end();
      }
    },
  );
  server.maxConnections = limits.maxConnections;
  // There is no Realtime service: every upgrade, WebSocket included, is a 404.
  server.on("upgrade", (req, socket) => {
    log({
      time: new Date().toISOString(),
      method: req.method ?? "",
      route: "none",
      path: ((req.url ?? "").split("?", 1)[0] ?? "").slice(0, 256),
      status: 404,
      ms: 0,
      key: "none",
      error: "upgrade",
    });
    socket.on("error", () => {});
    socket.end(
      "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  server.on("close", () => agent.destroy());
  return server;
}
