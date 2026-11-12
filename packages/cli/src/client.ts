import { randomUUID } from "node:crypto";
import {
  IdempotencyKey,
  OPS_ERROR_CODES,
  type OpsErrorCode,
} from "@mellodifai/shared";
import type { Credentials } from "./credentials.js";

export class ClientError extends Error {
  constructor(
    public code: OpsErrorCode,
    message: string,
    public retry_after?: number,
  ) {
    super(message);
  }
}

export function idempotencyKey(value?: unknown): string {
  const key = IdempotencyKey.safeParse(
    value === undefined ? randomUUID() : value,
  );
  if (!key.success)
    throw new ClientError(
      "validation",
      "La chiave di idempotenza deve contenere 8-100 caratteri.",
    );
  return key.data;
}

export async function send(
  credentials: Credentials,
  path: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(new URL(path, credentials.url), {
      ...init,
      headers: { Authorization: `Bearer ${credentials.pat}`, ...init.headers },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new ClientError(
      init.method === "POST" ? "ambiguous_spend" : "internal",
      "Connessione interrotta. Verifica lo stato prima di riprovare.",
    );
  }
}

export async function responseError(response: Response): Promise<ClientError> {
  const body = await response.json().catch(() => null);
  const error = body?.error;
  const code: OpsErrorCode =
    response.status === 401
      ? "unauthorized"
      : OPS_ERROR_CODES.includes(error?.code)
        ? error.code
        : "internal";
  // Do not echo arbitrary server text that could contain bearer credentials.
  return new ClientError(
    code,
    code,
    typeof error?.retry_after === "number" ? error.retry_after : undefined,
  );
}

export async function request(
  credentials: Credentials,
  path: string,
  body?: unknown,
  key?: string,
): Promise<unknown> {
  const response = await send(credentials, `/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey(key),
          },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await responseError(response);
  try {
    const result = await response.json();
    if (!result || typeof result !== "object" || !("data" in result))
      throw new Error("Invalid response");
    return result;
  } catch {
    throw new ClientError(
      body === undefined ? "internal" : "ambiguous_spend",
      "Risposta non valida. Verifica lo stato prima di riprovare.",
    );
  }
}
