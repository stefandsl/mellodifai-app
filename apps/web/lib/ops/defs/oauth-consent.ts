import { cookies } from "next/headers";
import { z } from "zod";
import { callOps } from "@/lib/db/ops-client";
import { mcpResource } from "../../../../../ops/lib/auth-origins";
import { sessionCtx } from "../context";
import type { OpDef } from "../types";

export type ConsentInfo = {
  client_name: string;
  client_id: string;
  redirect_host: string;
  registered_at: string;
  requested_scopes: string[];
};

export const consentUid = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u);
const decision = z.object({
  uid: consentUid,
  scopes: z
    .array(z.enum(["read", "create", "spend"]))
    .min(1)
    .max(3),
  testMode: z.boolean(),
  confirmName: z.string().max(120).optional(),
});
const input = decision.extend({
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  spendConfirmed: z.literal(true),
});

export async function flowNonce(): Promise<string> {
  const secure =
    new URL(mcpResource(process.env.SITE_URL)).protocol === "https:";
  const values = (await cookies()).getAll(
    secure ? "__Host-mdf_flow" : "mdf_flow",
  );
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/u.test(values[0].value)
    ? values[0].value
    : "";
}

// These fields come only from this server, never from the action's arguments.
export async function consentInput(value: z.infer<typeof decision>) {
  const parsed = decision.safeParse(value);
  const nonce = await flowNonce();
  let spendConfirmed = false;
  if (parsed.success && nonce) {
    if (!parsed.data.scopes.includes("spend")) spendConfirmed = true;
    else {
      try {
        const info = await callOps<ConsentInfo>("oauth_consent_info", [
          await sessionCtx(),
          parsed.data.uid,
          nonce,
        ]);
        spendConfirmed =
          info.ok && parsed.data.confirmName === info.data.client_name;
      } catch {
        // The authenticated action wrapper handles missing sessions; fail confirmation closed.
      }
    }
  }
  return { ...value, nonce, spendConfirmed };
}

export const oauthConsent: OpDef<
  z.infer<typeof input>,
  { token_id: string }
> = {
  name: "oauth_consent",
  fn: "oauth_consent",
  input,
  args: (v) => [v.uid, v.nonce, v.scopes, v.testMode],
  output: z.object({ token_id: z.uuid() }),
  scope: "admin",
  key: false,
  mutating: true,
  revalidate: () => [],
};
