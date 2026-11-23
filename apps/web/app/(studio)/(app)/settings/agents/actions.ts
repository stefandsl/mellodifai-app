"use server";

import { headers } from "next/headers";
import type { ActionResult } from "@/lib/action-result";
import {
  adminPairingOpen,
  adminRemoteMcp,
  adminTokenCreate,
  adminTokenRevoke,
  type TokenInput,
} from "@/lib/ops/defs/admin-agents";
import { newPat } from "@/lib/ops/tokens";
import { isRemote } from "@/lib/remote";
import { runAction } from "@/lib/run-action";

export async function createToken(
  input: TokenInput,
): Promise<ActionResult & { token?: string }> {
  if (isRemote(await headers()))
    return {
      ok: false,
      code: "forbidden_scope",
      error: "Disponibile solo dal PC locale.",
    };
  const pat = newPat();
  const result = await runAction(adminTokenCreate, {
    value: {
      ...input,
      expiresAt:
        input?.remote && input.expiresAt == null
          ? new Date(Date.now() + 90 * 86400000).toISOString()
          : input?.expiresAt,
    },
    hash: pat.hash,
    hint: pat.hint,
  });
  return result.ok && result.id ? { ...result, token: pat.token } : result;
}

export async function revokeToken(id: string): Promise<ActionResult> {
  return runAction(adminTokenRevoke, id);
}

export async function setRemoteMcp(enabled: boolean): Promise<ActionResult> {
  return runAction(adminRemoteMcp, enabled);
}

export async function openPairing(): Promise<ActionResult> {
  return runAction(adminPairingOpen, {});
}
