import { z } from "zod";
import { define } from "./base";

export const tokenInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    scopes: z
      .array(z.enum(["read", "create", "spend"]))
      .min(1)
      .max(3),
    remote: z.boolean(),
    testMode: z.boolean(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine(
    (v) =>
      (!v.remote || v.expiresAt !== null) &&
      (v.expiresAt === null || Date.parse(v.expiresAt) > Date.now()),
  );

export type TokenInput = z.infer<typeof tokenInput>;
const createInput = z.object({
  value: tokenInput,
  hash: z.string().regex(/^[0-9a-f]{64}$/u),
  hint: z.string().max(32),
});

export const adminTokenCreate = {
  ...define(
    "admin_token_create",
    createInput,
    ({ value: v, hash, hint }) => [
      v.name,
      hash,
      hint,
      v.scopes,
      v.remote,
      v.testMode,
      v.expiresAt,
    ],
    z.object({ id: z.uuid() }),
    "admin",
  ),
  key: false,
  revalidate: () => ["/settings/agents"],
};

export const adminTokenRevoke = {
  ...define(
    "admin_token_revoke",
    z.uuid(),
    (id) => [id],
    z.object({ id: z.uuid() }),
    "admin",
  ),
  key: false,
  revalidate: () => ["/settings/agents"],
};

export const adminRemoteMcp = {
  ...define(
    "admin_flag_set",
    z.boolean(),
    (enabled) => ["remote_mcp", enabled],
    z.object({ flag: z.literal("remote_mcp"), enabled: z.boolean() }),
    "admin",
  ),
  key: false,
  revalidate: () => ["/settings/agents"],
};

export const adminPairingOpen = {
  ...define(
    "admin_pairing_open",
    z.object({}),
    () => [],
    z.object({ open_until: z.string() }),
    "admin",
  ),
  key: false,
  revalidate: () => ["/settings/agents"],
};

export type AgentToken = {
  id: string;
  name: string;
  kind: string;
  token_hint: string | null;
  scopes: string[];
  remote: boolean;
  test_mode: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type PairingStatus = {
  open_until: string | null;
  client_name: string | null;
  redirect_host: string | null;
  registered_at: string | null;
};
