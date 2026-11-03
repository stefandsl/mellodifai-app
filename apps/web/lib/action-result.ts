import type { OpsErrorCode } from "@mellodifai/shared";

export type ActionResult =
  | { ok: true; id?: string; count?: number; committed?: true }
  | { ok: false; error: string; code?: OpsErrorCode; idempotencyKey?: string };
export type ActionCallback = () =>
  | void
  | ActionResult
  | Promise<void>
  | Promise<ActionResult>;
