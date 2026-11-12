import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { StageContext } from "../loop.js";

export type Items = Record<string, number>;

export async function validateEngineEntries(
  client: SupabaseClient,
  entries: string[],
  providers: string[],
): Promise<boolean> {
  const { data, error } = await client
    .schema("ops")
    .rpc("spend_entries_authorize", {
      p_entries: entries,
      p_providers: providers,
    });
  if (error) throw error;
  return data === true;
}

export type Ledger = {
  reservationFor(jobId: string): Promise<string | null>;
  open(key: string, items: Items): Promise<string>;
  settle(entryId: string, items: Items, usd?: number): Promise<void>;
  extend(items: Items): Promise<void>;
  extendStage(jobId: string): Promise<void>;
  markAmbiguous(): Promise<void>;
};

export async function ensureReservation(
  ledger: Ledger,
  job: { id: string },
): Promise<string> {
  try {
    const reservation = await ledger.reservationFor(job.id);
    if (!reservation)
      throw new Error("cap_exceeded: paid call has no reservation");
    return reservation;
  } catch (error) {
    if (
      ["MDF02", "MDF06"].includes(
        (error as { code?: string } | null)?.code ?? "",
      )
    )
      throw new Error("cap_exceeded", { cause: error });
    throw error;
  }
}

export function isCapRefusal(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "MDF02" ||
    code === "MDF06" ||
    (error instanceof Error &&
      (error.message.startsWith("cap_exceeded") || isCapRefusal(error.cause)))
  );
}

export async function extendStageReservation(
  ledger: Ledger,
  job: { id: string },
): Promise<void> {
  try {
    await ledger.extendStage(job.id);
  } catch (error) {
    if (isCapRefusal(error)) throw new Error("cap_exceeded", { cause: error });
    throw error;
  }
}

export function kieLedger(
  context: Pick<StageContext, "kieLedger" | "secrets">,
): Ledger {
  if (context.kieLedger) return context.kieLedger();
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } =
    context.secrets.values;
  if (!url || !key) throw new Error("database ledger is not configured");
  return serviceLedger(createClient(url, key), null, "kie", "");
}

export function serviceLedger(
  client: SupabaseClient,
  reservationId: string | null,
  provider: string,
  model: string,
): Ledger {
  const ops = client.schema("ops");
  let activeReservation = reservationId;
  const reservation = () => {
    if (!activeReservation) throw new Error("paid call has no reservation");
    return activeReservation;
  };
  return {
    async reservationFor(jobId) {
      const { data, error } = await ops.rpc("reserve_job", { p_job: jobId });
      if (error) throw error;
      activeReservation = data as string | null;
      return activeReservation;
    },
    async extendStage(jobId) {
      const { data, error } = await ops.rpc("job_spend_rule", { p_job: jobId });
      if (error) throw error;
      if (!Array.isArray(data) || data.length === 0)
        throw new Error("paid stage has no estimate");
      // All models must clear their caps before the first provider request.
      for (const rule of data) {
        const { error } = await ops.rpc("extend_reservation", {
          p_reservation: reservation(),
          p_provider: rule.provider,
          p_model: rule.model,
          p_items: rule.items,
        });
        if (error) throw error;
      }
    },
    async open(key, items) {
      const { data, error } = await ops.rpc("spend_entry_open", {
        p_reservation: reservation(),
        p_call_key: key,
        p_provider: provider,
        p_model: model,
        p_items_est: items,
      });
      if (error) throw error;
      if (typeof data !== "string") throw new Error("spend entry has no id");
      return data;
    },
    async settle(entryId, items, usd) {
      const { error } = await ops.rpc("settle_spend", {
        p_entry: entryId,
        p_items: items,
        p_usd: usd ?? null,
      });
      if (error) throw error;
    },
    async extend(items) {
      const { error } = await ops.rpc("extend_reservation", {
        p_reservation: reservation(),
        p_provider: provider,
        p_model: model,
        p_items: items,
      });
      if (error) throw error;
    },
    async markAmbiguous() {
      const { error } = await ops.rpc("mark_ambiguous", {
        p_reservation: reservation(),
      });
      if (error) throw error;
    },
  };
}
