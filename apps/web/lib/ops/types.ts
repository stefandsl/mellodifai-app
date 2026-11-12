import type { OpsResult } from "@mellodifai/shared";
import type { ZodType } from "zod";

// A committed mutation can lack a valid public payload. Never cast that payload to O.
export type OpRunResult<O> = (OpsResult<O> | { ok: true; committed: true }) & {
  idempotency_key?: string;
};

export type OpsCtx = {
  actor_kind: "session" | "pat" | "oauth";
  user_id?: string;
  session_id?: string;
  token_hash?: string;
  access_token_hash?: string;
  resource?: string;
  token_id?: string;
  remote: boolean;
  request_id: string;
  idempotency_key?: string;
  request_hash?: string;
};

export type OpDef<I, O> = {
  name: string;
  fn: string;
  // What an agent reads in tools/list; every token operation has one.
  description?: string;
  input: ZodType<I>;
  // SQL arguments after p_ctx, in the function signature's order.
  args: (input: I) => unknown[];
  output: ZodType<O>;
  scope: "read" | "create" | "spend" | "admin";
  key: boolean;
  mutating: boolean;
  reservesPaidWork?: boolean;
  revalidate: (data: O) => string[];
};
