import { createHash, randomUUID } from "node:crypto";
import type { OpsResult } from "@mellodifai/shared";
import { revalidatePath } from "next/cache";
import { callOps } from "@/lib/db/ops-client";
import {
  PUBLISHING_OFF_MESSAGE,
  PUBLISHING_OPS,
  publishingOff,
} from "@/lib/publishing-off";
import type { OpDef, OpRunResult, OpsCtx } from "./types";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function requestHash(op: string, input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ op, input })))
    .digest("hex");
}

export async function runOp<I, O>(
  def: OpDef<I, O>,
  ctx: OpsCtx,
  input: unknown,
): Promise<OpRunResult<O>> {
  let result: OpsResult<O>;
  let key: string | undefined;
  let dispatched = false;
  const uncertain = (): OpRunResult<O> => ({
    ok: false,
    code:
      def.mutating && (def.scope === "spend" || def.reservesPaidWork)
        ? "ambiguous_spend"
        : "internal",
    message:
      "Completion unknown. Do not automatically retry. Retain the original idempotency key.",
    ...(key ? { idempotency_key: key } : {}),
  });
  if (publishingOff() && PUBLISHING_OPS.has(def.name))
    return {
      ok: false,
      code: "forbidden_scope",
      message: PUBLISHING_OFF_MESSAGE,
    };
  try {
    const parsed = def.input.safeParse(input);
    if (!parsed.success)
      return { ok: false, code: "validation", message: "Invalid input" };
    const requestCtx = {
      ...ctx,
      request_hash: requestHash(def.name, parsed.data),
    };
    const args = def.args(parsed.data);
    if (def.key) {
      key =
        ctx.idempotency_key ??
        (ctx.actor_kind === "session" ? randomUUID() : undefined);
      if (!key || key.length < 8 || key.length > 100)
        return {
          ok: false,
          code: "validation",
          message: "Invalid idempotency key",
        };
      requestCtx.idempotency_key = key;
      // callOps uses an autocommit statement; opening completes before the mutation starts.
      const begin = await callOps<
        { status: "new" } | { status: "replay"; response: OpsResult<O> }
      >("idem_begin", [requestCtx, key, requestCtx.request_hash]);
      if (!begin.ok) return { ...begin, idempotency_key: key };
      if (begin.data?.status === "replay") {
        result = begin.data.response;
        if (!result || typeof result.ok !== "boolean")
          return {
            ok: false,
            code: "internal",
            message: "Invalid idempotency response",
          };
      } else if (begin.data?.status === "new") {
        dispatched = true;
        result = await callOps<O>(def.fn, [requestCtx, ...args]);
      } else {
        return {
          ok: false,
          code: "internal",
          message: "Invalid idempotency response",
        };
      }
    } else {
      dispatched = true;
      result = await callOps<O>(def.fn, [requestCtx, ...args]);
    }
  } catch {
    if (dispatched) return uncertain();
    return { ok: false, code: "internal", message: "Internal error" };
  }
  if (!result.ok) {
    if (
      dispatched &&
      result.details &&
      typeof result.details === "object" &&
      "reason" in result.details &&
      result.details.reason === "completion_unknown"
    )
      return uncertain();
    return { ...result, ...(key ? { idempotency_key: key } : {}) };
  }
  let data: O;
  try {
    data = def.output.parse(result.data);
  } catch {
    console.error("Operation output contract validation failed:", def.name);
    if (def.mutating) return { ok: true, committed: true };
    return {
      ok: false,
      code: "internal",
      message: "Invalid operation response",
    };
  }
  if (def.mutating) {
    try {
      for (const path of def.revalidate(data)) revalidatePath(path);
      for (const path of ["/library", "/create", "/playlists", "/search"])
        revalidatePath(path);
      for (const path of [
        "/projects/[id]",
        "/playlists/[id]",
        "/stems/[id]",
        "/editor/[id]",
      ])
        revalidatePath(path, "page");
    } catch {
      // The mutation committed. Reporting failure could cause a duplicate paid job.
      console.error("Operation committed, but path revalidation failed");
    }
  }
  return { ok: true, data };
}
