import { readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Provider, { errors, type JWKS } from "oidc-provider";
import {
  connectOps,
  OpsAdapter,
  type OpsCall,
  redirectAllowed,
} from "./adapter.js";
import { interaction } from "./interaction.js";

export function createAuth(config: {
  issuer: string;
  cookieKeys: string[];
  jwks: JWKS;
  call: OpsCall;
}) {
  const issuer = new URL(config.issuer);
  if (
    issuer.pathname !== "/oauth" ||
    issuer.search ||
    issuer.hash ||
    issuer.username ||
    issuer.password ||
    !["http:", "https:"].includes(issuer.protocol) ||
    (issuer.protocol === "http:" && issuer.hostname !== "127.0.0.1")
  )
    throw new Error("Invalid auth issuer");
  if (
    !config.cookieKeys.length ||
    config.cookieKeys.some((key) => key.length < 32)
  )
    throw new Error("Auth cookie keys are required");
  if (!config.jwks.keys.length)
    throw new Error("Auth signing keys are required");
  const resource = new URL("/api/mcp", issuer).href;
  const provider = new Provider(config.issuer, {
    adapter: class extends OpsAdapter {
      constructor(model: string) {
        super(model, config.call);
      }
    },
    jwks: config.jwks,
    cookies: {
      keys: config.cookieKeys,
      short: { signed: true, sameSite: "lax" },
    },
    responseTypes: ["code"],
    scopes: ["openid", "offline_access"],
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, issueRegistrationAccessToken: false },
      registrationManagement: { enabled: false },
      resourceIndicators: {
        enabled: true,
        defaultResource() {
          throw new errors.InvalidTarget("resource is required");
        },
        useGrantedResource: () => false,
        getResourceServerInfo(_ctx, value) {
          if (value !== resource) throw new errors.InvalidTarget();
          return {
            scope: "read create spend",
            audience: resource,
            accessTokenFormat: "opaque",
            accessTokenTTL: 3600,
          };
        },
      },
    },
    extraClientMetadata: {
      properties: [
        "redirect_uris",
        "client_name",
        "sector_identifier_uri",
        "jwks_uri",
      ],
      validator(_ctx, key, value, metadata) {
        if (
          key === "redirect_uris" &&
          (!Array.isArray(value) ||
            !value.length ||
            !value.every(
              (uri) => typeof uri === "string" && redirectAllowed(uri),
            ))
        )
          throw new errors.InvalidClientMetadata("redirect URI is not allowed");
        if (key === "client_name") {
          if (typeof value !== "string" || !value.trim())
            throw new errors.InvalidClientMetadata("client_name is required");
          metadata.client_name = Array.from(value).slice(0, 60).join("");
        }
        // M1 clients do not need server-side fetches of remote client metadata.
        if (
          (key === "sector_identifier_uri" || key === "jwks_uri") &&
          value !== undefined
        )
          throw new errors.InvalidClientMetadata(
            "remote client metadata is not supported",
          );
      },
    },
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      RefreshToken: 2592000,
      Interaction: 900,
      Grant: 7776000,
      Session: 900,
    },
    issueRefreshToken: (_ctx, client) =>
      client.grantTypeAllowed("refresh_token"),
    // SQL grant revocation governs MCP tokens, not the short browser session.
    expiresWithSession: () => false,
    rotateRefreshToken: () => true,
    interactions: { url: (_ctx, value) => `/oauth/interaction/${value.uid}` },
    findAccount: (_ctx, id) => ({ accountId: id, claims: () => ({ sub: id }) }),
    renderError: (ctx, _out, error) => {
      ctx.type = "application/json";
      ctx.body = {
        error:
          "expose" in error && error.expose ? error.message : "server_error",
      };
    },
  });
  provider.proxy = true;
  provider.silent = true;
  provider.on("server_error", () => {});
  provider.use(async (ctx, next) => {
    if (ctx.path === "/token" && ctx.method === "POST") {
      if (!ctx.is("application/x-www-form-urlencoded"))
        throw new errors.InvalidRequest("form body required");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of ctx.req) {
        size += chunk.length;
        if (size > 56 * 1024) throw new errors.InvalidRequest("body too large");
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const values = new URLSearchParams(body).getAll("resource");
      if (values.length !== 1 || values[0] !== resource)
        throw new errors.InvalidTarget("one explicit MCP resource required");
      // The library's selective parser accepts the preserved raw form body.
      (ctx.req as IncomingMessage & { body: string }).body = body;
    }
    await next();
  });
  const callback = provider.callback();
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = new URL(req.url ?? "/", config.issuer).pathname;
      const match = /^\/oauth\/interaction\/([A-Za-z0-9_-]+)(\/resume)?$/u.exec(
        path,
      );
      if (match) {
        if (req.method !== "GET") {
          res.writeHead(405, { Allow: "GET" }).end();
          return;
        }
        await interaction(
          req,
          res,
          provider,
          config.call,
          config.issuer,
          match[1] as string,
          Boolean(match[2]),
        );
        return;
      }
      if (
        [
          "/.well-known/oauth-authorization-server/oauth",
          "/.well-known/openid-configuration/oauth",
        ].includes(path)
      )
        req.url = "/oauth/.well-known/openid-configuration";
      if (req.url?.startsWith("/oauth/")) {
        (req as IncomingMessage & { originalUrl: string }).originalUrl =
          req.url;
        req.url = req.url.slice("/oauth".length);
        await callback(req, res);
      } else res.writeHead(404).end();
    } catch {
      if (!res.headersSent) res.writeHead(500).end("Errore interno.");
      else res.end();
    }
  };
  return { provider, handler };
}

export function startAuth() {
  const { MDF_AUTH_ISSUER, MDF_AUTH_DATABASE_URL, MDF_AUTH_COOKIE_KEYS } =
    process.env;
  if (!MDF_AUTH_ISSUER || !MDF_AUTH_DATABASE_URL || !MDF_AUTH_COOKIE_KEYS)
    throw new Error("Auth environment is not provisioned");
  if (process.env.HOST && process.env.HOST !== "127.0.0.1")
    throw new Error("Auth must listen on IPv4 loopback");
  const port = Number(process.env.PORT ?? 3010);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid auth port");
  const root =
    process.env.RUNNER_TEMP ?? process.env.MELLODIFAI_ROOT ?? "E:/mellodifai";
  const keyFile =
    process.env.MDF_AUTH_JWKS_PATH ?? join(root, "secrets/auth/jwks.json");
  const db = connectOps(MDF_AUTH_DATABASE_URL);
  const app = createAuth({
    issuer: MDF_AUTH_ISSUER,
    cookieKeys: JSON.parse(MDF_AUTH_COOKIE_KEYS),
    jwks: JSON.parse(readFileSync(keyFile, "utf8")),
    call: db.call,
  });
  const server = createServer(app.handler);
  server.on("error", () => {
    process.stderr.write("Auth listener failed\n");
    process.exitCode = 1;
    void db.close();
  });
  server.listen(port, "127.0.0.1");
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      server.close(() => {
        void db.close();
      });
    });
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    startAuth();
  } catch {
    process.stderr.write("Auth startup failed; verify private configuration\n");
    process.exitCode = 1;
  }
}
