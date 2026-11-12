export const OPS_ERROR_CODES = [
  "unauthorized",
  "forbidden_scope",
  "not_found",
  "conflict",
  "idempotency_mismatch",
  "in_progress",
  "ambiguous_spend",
  "validation",
  "cap_exceeded",
  "rate_limited",
  "internal",
] as const;

export type OpsErrorCode = (typeof OPS_ERROR_CODES)[number];
export const HTTP_STATUS: Record<OpsErrorCode, number> = {
  unauthorized: 401,
  forbidden_scope: 403,
  not_found: 404,
  conflict: 409,
  idempotency_mismatch: 409,
  in_progress: 409,
  ambiguous_spend: 409,
  validation: 422,
  cap_exceeded: 402,
  rate_limited: 429,
  internal: 500,
};

// MDF08-MDF12 are reserved, not public error mappings.
export const MDF_STATES = {
  MDF01: { code: "validation", reason: "idempotency_key_required" },
  MDF02: { code: "cap_exceeded", reason: "cap" },
  MDF03: { code: "unauthorized", reason: "claim" },
  MDF04: { code: "forbidden_scope", reason: "test_rule" },
  MDF05: { code: "internal", reason: "price_missing" },
  MDF06: { code: "cap_exceeded", reason: "no_cap" },
  MDF07: { code: "cap_exceeded", reason: "entry_beyond_reservation" },
} as const satisfies Record<string, { code: OpsErrorCode; reason: string }>;

export type OpsError = {
  code: OpsErrorCode;
  message: string;
  details?: unknown;
  retry_after?: number;
};
export type OpsResult<T> = { ok: true; data: T } | ({ ok: false } & OpsError);
