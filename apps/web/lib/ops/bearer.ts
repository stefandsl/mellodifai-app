import { createHash, randomUUID } from "node:crypto";
import { HTTP_STATUS, type OpsResult } from "@mellodifai/shared";
import { opsSql } from "@/lib/db/ops-client";
import { rateLimit } from "@/lib/rate-limit";
import { isRemote } from "@/lib/remote";
import { mcpResource } from "../../../../ops/lib/auth-origins";
import { runOp } from "./run";
import type { OpDef, OpsCtx } from "./types";

export async function bearerCtx(
  req: Request,
  allow: Array<"pat" | "oauth">,
): Promise<OpsCtx | null> {
  const match = /^Bearer ([^\s]+)$/i.exec(
    req.headers.get("authorization") ?? "",
  );
  if (!match) return null;
  const token = match[1];
  const kind = token.startsWith("mdf_pat_") ? "pat" : "oauth";
  if (!allow.includes(kind)) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const ctx: OpsCtx = {
    actor_kind: kind,
    remote: isRemote(req.headers),
    request_id: randomUUID(),
  };
  // PAT validity, scope and revocation are checked by every database operation.
  if (kind === "pat") return { ...ctx, token_hash: hash };
  try {
    const resource = mcpResource(process.env.SITE_URL);
    // This infrastructure function returns identity directly, not an OpsResult.
    const [row] = await opsSql().unsafe<
      { result: { user_id: string; token_id: string } }[]
    >("select ops.resolve_access_token($1, $2) as result", [hash, resource]);
    if (
      typeof row?.result?.user_id !== "string" ||
      typeof row.result.token_id !== "string"
    )
      return null;
    return {
      ...ctx,
      user_id: row.result.user_id,
      token_id: row.result.token_id,
      access_token_hash: hash,
      resource,
    };
  } catch {
    return null;
  }
}

// HTTP and MCP use this runner; runOp owns validation and committed idem_begin.
export async function runTokenOperation<I, O>(
  def: OpDef<I, O>,
  ctx: OpsCtx | null,
  input: unknown,
): Promise<OpsResult<O>> {
  const identity =
    ctx?.actor_kind === "pat"
      ? ctx.token_hash
      : ctx?.actor_kind === "oauth"
        ? ctx.token_id
        : undefined;
  if (!ctx || !identity)
    return {
      ok: false,
      code: "unauthorized",
      message: "Authentication required",
    };
  const key = `${ctx.actor_kind}:${identity}`;
  const limit = rateLimit(key, def.mutating ? "write" : "read");
  if (!limit.ok)
    return {
      ok: false,
      code: "rate_limited",
      message: "Rate limit exceeded",
      retry_after: limit.retryAfter,
    };
  if (def.mutating && (def.scope === "spend" || def.reservesPaidWork)) {
    const reservation = rateLimit(key, "reservation");
    if (!reservation.ok)
      return {
        ok: false,
        code: "rate_limited",
        message: "Reservation rate limit exceeded",
        retry_after: reservation.retryAfter,
      };
  }
  const result = await runOp(def, ctx, input);
  if (result.ok && "committed" in result)
    return {
      ok: false,
      code:
        def.scope === "spend" || def.reservesPaidWork
          ? "ambiguous_spend"
          : "internal",
      message: "Operation committed without a valid response. Do not retry.",
      details: { committed: true },
    };
  if (!result.ok) {
    const { code, message, details, retry_after } = result;
    return {
      ok: false,
      code,
      message,
      ...(details === undefined ? {} : { details }),
      ...(retry_after === undefined ? {} : { retry_after }),
    };
  }
  return result;
}

export async function runTokenOp<I, O>(
  def: OpDef<I, O>,
  req: Request,
  input: unknown,
): Promise<Response> {
  const mcp = new URL(req.url).pathname === "/api/mcp";
  const ctx = await bearerCtx(req, mcp ? ["pat", "oauth"] : ["pat"]);
  if (ctx)
    ctx.idempotency_key = req.headers.get("Idempotency-Key") ?? undefined;
  const result = await runTokenOperation(def, ctx, input);
  if (result.ok) return Response.json({ data: result.data });
  const { ok: _, ...error } = result;
  const headers = new Headers();
  if (error.retry_after !== undefined)
    headers.set("Retry-After", String(error.retry_after));
  if (error.code === "unauthorized") {
    try {
      headers.set(
        "WWW-Authenticate",
        mcp
          ? `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/api/mcp", mcpResource(process.env.SITE_URL)).href}"`
          : "Bearer",
      );
    } catch {
      return Response.json(
        { error: { code: "internal", message: "Internal error" } },
        { status: 500 },
      );
    }
  }
  return Response.json({ error }, { status: HTTP_STATUS[error.code], headers });
}
