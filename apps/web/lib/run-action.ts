import { type OpsErrorCode, t } from "@mellodifai/shared";
import { headers } from "next/headers";
import type { ZodType } from "zod";
import type { ActionResult } from "./action-result";
import { getLocale } from "./locale";
import { sessionCtx } from "./ops/context";
import { runOp } from "./ops/run";
import type { OpDef } from "./ops/types";
import { isRemote } from "./remote";

export function runAction<I, O>(
  def: OpDef<I, O>,
  input: unknown,
  options?: { idempotencyKey?: string; count?: number },
): Promise<ActionResult>;
export async function runAction<I, O>(
  def: OpDef<I, O>,
  input: unknown,
  options?: { idempotencyKey?: string; count?: number },
): Promise<ActionResult> {
  try {
    if (isRemote(await headers())) return opsFailure("forbidden_scope");
  } catch {
    return opsFailure("internal");
  }
  return remoteAction(def, input, options);
}

async function opsFailure(code: OpsErrorCode): Promise<ActionResult> {
  return { ok: false, code, error: t(await getLocale(), `error.${code}`) };
}

type UnauthenticatedAction<I> = {
  unauthenticated: true;
  input: ZodType<I>;
  rateLimit: (input: I) => boolean;
  run: (input: I) => Promise<ActionResult>;
};

export async function remoteAction<I, O>(
  def: OpDef<I, O> | UnauthenticatedAction<I>,
  input: unknown,
  options?: { idempotencyKey?: string; count?: number },
): Promise<ActionResult> {
  if ("unauthenticated" in def) {
    const parsed = def.input.safeParse(input);
    if (!parsed.success) return opsFailure("validation");
    if (!def.rateLimit(parsed.data)) return opsFailure("rate_limited");
    // These public sign-in handlers own their errors and may redirect after verification.
    return def.run(parsed.data);
  }
  try {
    const ctx = await sessionCtx();
    const result = await runOp(
      def,
      { ...ctx, idempotency_key: options?.idempotencyKey },
      input,
    );
    if (!result.ok)
      return {
        ...(await opsFailure(result.code)),
        ...(result.idempotency_key
          ? { idempotencyKey: result.idempotency_key }
          : {}),
      };
    if ("committed" in result) return { ok: true, committed: true };
    const data = result.data;
    const id =
      data && typeof data === "object"
        ? "project_id" in data
          ? data.project_id
          : "playlist_id" in data
            ? data.playlist_id
            : "id" in data
              ? data.id
              : "edit_id" in data
                ? data.edit_id
                : "take_id" in data
                  ? data.take_id
                  : "job_id" in data
                    ? data.job_id
                    : "jobs" in data && Array.isArray(data.jobs)
                      ? data.jobs[0]?.job_id
                      : undefined
        : undefined;
    const count =
      data && typeof data === "object" && "count" in data
        ? data.count
        : options?.count;
    return {
      ok: true,
      ...(typeof id === "string" ? { id } : {}),
      ...(typeof count === "number" ? { count } : {}),
    };
  } catch {
    return opsFailure("unauthorized");
  }
}
