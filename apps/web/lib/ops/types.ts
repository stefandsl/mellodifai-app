import type { ZodType } from "zod";

export type OpsCtx = {
  actor_kind: "session" | "pat" | "oauth";
  user_id?: string;
  session_id?: string;
  token_hash?: string;
  access_token_hash?: string;
  remote: boolean;
  request_id: string;
  idempotency_key?: string;
  request_hash?: string;
};

export type OpDef<I, O> = {
  name: string;
  fn: string;
  input: ZodType<I>;
  output: ZodType<O>;
  scope: "read" | "create" | "spend" | "admin";
  key: boolean;
  mutating: boolean;
  revalidate: (data: O) => string[];
};
