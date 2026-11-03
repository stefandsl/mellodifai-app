import type { OpsErrorCode } from "@mellodifai/shared";

export type ActionResult =
  | { ok: true; id?: string; count?: number }
  | { ok: false; error: string; code?: OpsErrorCode };
export type ActionCallback = () =>
  | void
  | ActionResult
  | Promise<void>
  | Promise<ActionResult>;
