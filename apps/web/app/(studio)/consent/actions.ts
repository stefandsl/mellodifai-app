"use server";

import type { ActionResult } from "@/lib/action-result";
import { consentInput, oauthConsent } from "@/lib/ops/defs/oauth-consent";
import { remoteAction } from "@/lib/run-action";

export async function consentDecide(
  uid: string,
  scopes: Array<"read" | "create" | "spend">,
  testMode: boolean,
  confirmName?: string,
): Promise<ActionResult> {
  return remoteAction(
    oauthConsent,
    await consentInput({ uid, scopes, testMode, confirmName }),
  );
}
