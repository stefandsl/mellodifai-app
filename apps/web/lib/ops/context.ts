import { headers } from "next/headers";
import { getActionClaims } from "@/lib/auth";
import { isRemote } from "@/lib/remote";
import type { OpsCtx } from "./types";

export async function sessionCtx(): Promise<OpsCtx> {
  const [claims, requestHeaders] = await Promise.all([
    getActionClaims(),
    headers(),
  ]);
  return {
    actor_kind: "session",
    user_id: claims.sub,
    session_id: claims.session_id,
    remote: isRemote(requestHeaders),
    request_id: crypto.randomUUID(),
  };
}
