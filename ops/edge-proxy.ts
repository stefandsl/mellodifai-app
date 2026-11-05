import {
  createServer,
  type IncomingHttpHeaders,
  request,
  type Server,
} from "node:http";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const nextPaths = new Set([
  "/api/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/api/mcp",
  "/login",
  "/auth/confirm",
  "/consent",
  "/api/health",
  "/_next/image",
  "/favicon.ico",
]);
const authPaths = new Set([
  "/.well-known/oauth-authorization-server/oauth",
  "/.well-known/openid-configuration/oauth",
]);

function endToEndHeaders(source: IncomingHttpHeaders): IncomingHttpHeaders {
  const headers = { ...source };
  for (const name of [
    ...(source.connection ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase()),
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ])
    delete headers[name];
  return headers;
}

export function createEdgeProxy(opts: {
  listen: number;
  next: string;
  auth: string;
  mode: "prod" | "local";
}): Server {
  const next = new URL(opts.next);
  const auth = new URL(opts.auth);
  if ([next, auth].some((url) => url.protocol !== "http:")) {
    throw new Error("Edge upstreams must use HTTP");
  }
  const limits = {
    oauth: { max: 60, windowMs: 60_000, hits: new Map<string, number[]>() },
    registration: {
      max: 10,
      windowMs: 3_600_000,
      hits: new Map<string, number[]>(),
    },
    login: { max: 5, windowMs: 900_000, hits: new Map<string, number[]>() },
    api: { max: 120, windowMs: 60_000, hits: new Map<string, number[]>() },
  };
  let pruneAt = 0;
  const server = createServer((req, res) => {
    const target = req.url ?? "";
    const path = target.split("?", 1)[0] ?? "";
    // Reject ambiguous paths before either framework can decode or normalize them.
    if (
      !path.startsWith("/") ||
      /[%\\]/.test(path) ||
      path.includes("//") ||
      new URL(target, "http://edge").pathname !== path
    ) {
      res.writeHead(404).end();
      return;
    }
    if (
      req.headers["next-action"] !== undefined &&
      path !== "/login" &&
      path !== "/consent"
    ) {
      res.writeHead(403).end();
      return;
    }
    const oauth = path.startsWith("/oauth/");
    const upstream =
      oauth || authPaths.has(path)
        ? auth
        : opts.mode === "local" ||
            nextPaths.has(path) ||
            path.startsWith("/api/v1/") ||
            path.startsWith("/_next/static/")
          ? next
          : undefined;
    if (!upstream) {
      res.writeHead(404).end();
      return;
    }

    const now = Date.now();
    if (now >= pruneAt) {
      for (const { hits, windowMs } of Object.values(limits)) {
        for (const [ip, times] of hits) {
          if (now - (times.at(-1) ?? 0) >= windowMs) hits.delete(ip);
        }
      }
      pruneAt = now + 60_000;
    }
    const cfIp = req.headers["cf-connecting-ip"];
    const ip =
      typeof cfIp === "string" && isIP(cfIp)
        ? cfIp
        : (req.socket.remoteAddress ?? "unknown");
    const kinds: (keyof typeof limits)[] = [];
    if (oauth) kinds.push("oauth");
    if (req.method === "POST" && /^\/oauth\/reg\/?$/.test(path))
      kinds.push("registration");
    if (path === "/login" && req.method === "POST") kinds.push("login");
    if (path.startsWith("/api/")) kinds.push("api");
    for (const kind of kinds) {
      const { max, windowMs, hits } = limits[kind];
      const recent = (hits.get(ip) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= max) {
        res
          .writeHead(429, {
            "retry-after": String(
              Math.ceil(((recent[0] ?? now) + windowMs - now) / 1000),
            ),
          })
          .end();
        return;
      }
      hits.set(ip, [...recent, now]);
    }

    const headers = endToEndHeaders(req.headers);
    const address = server.address();
    const host =
      opts.mode === "prod"
        ? "app.mellodifai.com"
        : `127.0.0.1:${typeof address === "object" && address ? address.port : opts.listen}`;
    headers.host = host;
    headers["x-forwarded-host"] = host;
    headers["x-forwarded-proto"] = opts.mode === "prod" ? "https" : "http";
    headers["x-forwarded-for"] = ip;
    delete headers.forwarded;
    delete headers["x-mdf-remote"];
    if (opts.mode === "prod") headers["x-mdf-remote"] = "1";
    const outgoing = request(
      upstream,
      { method: req.method, path: target, headers },
      (incoming) => {
        res.writeHead(
          incoming.statusCode ?? 502,
          endToEndHeaders(incoming.headers),
        );
        incoming.on("error", () => res.destroy());
        incoming.pipe(res);
      },
    );
    outgoing.on("error", () => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end();
    });
    req.on("error", () => outgoing.destroy());
    res.on("close", () => outgoing.destroy());
    req.pipe(outgoing);
  });
  return server.listen(opts.listen, "127.0.0.1");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        mode: { type: "string", default: "prod" },
        listen: { type: "string" },
        next: { type: "string" },
        auth: { type: "string" },
      },
    });
    const mode = values.mode;
    if (mode !== "prod" && mode !== "local") throw new Error("Invalid mode");
    const listen = Number(values.listen ?? (mode === "prod" ? 3080 : 3212));
    if (!Number.isInteger(listen) || listen < 1 || listen > 65535)
      throw new Error("Invalid port");
    const server = createEdgeProxy({
      listen,
      mode,
      next:
        values.next ??
        `http://127.0.0.1:${mode === "prod" ? 3000 : (process.env.E2E_PORT ?? 3210)}`,
      auth: values.auth ?? `http://127.0.0.1:${mode === "prod" ? 3010 : 3211}`,
    });
    server.on("error", () => {
      process.stderr.write("Edge proxy listener failed\n");
      process.exitCode = 1;
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => server.close());
  } catch {
    process.stderr.write(
      "Usage: edge-proxy.ts [--mode prod|local] [--listen port] [--next http-origin] [--auth http-origin]\n",
    );
    process.exitCode = 1;
  }
}
