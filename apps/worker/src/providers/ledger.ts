import type { SupabaseClient } from "@supabase/supabase-js";

export type Items = Record<string, number>;

export type Ledger = {
  reservationFor(jobId: string): Promise<string | null>;
  open(key: string, items: Items): Promise<string>;
  settle(entryId: string, items: Items, usd?: number): Promise<void>;
  extend(items: Items): Promise<void>;
};

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
  };
}
