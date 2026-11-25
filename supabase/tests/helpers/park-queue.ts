import type { SupabaseClient } from "@supabase/supabase-js";

const PARKED = "9999-12-31T00:00:00Z";

/**
 * claim_job takes the oldest claimable job in the whole database. Earlier test
 * files leave queued jobs behind, and only a running worker drains them. Park
 * every claimable queued job outside `keepPrefix` (not_before far ahead) so a
 * claim test sees only its own jobs; the returned function restores each job's
 * own not_before.
 */
export async function parkOtherQueuedJobs(
  service: SupabaseClient,
  keepPrefix: string,
): Promise<() => Promise<void>> {
  const { data, error } = await service
    .from("jobs")
    .select("id, not_before")
    .eq("status", "queued")
    .not("idempotency_key", "like", `${keepPrefix}%`)
    .or(`not_before.is.null,not_before.lte.${new Date().toISOString()}`);
  if (error) throw new Error(`Cannot list queued jobs: ${error.message}`);
  const parked = (data ?? []) as { id: string; not_before: string | null }[];
  if (parked.length > 0) {
    const { error: parkError } = await service
      .from("jobs")
      .update({ not_before: PARKED })
      .in(
        "id",
        parked.map((job) => job.id),
      );
    if (parkError)
      throw new Error(`Cannot park queued jobs: ${parkError.message}`);
  }
  return async () => {
    for (const job of parked) {
      const { error: restoreError } = await service
        .from("jobs")
        .update({ not_before: job.not_before })
        .eq("id", job.id)
        .eq("not_before", PARKED);
      if (restoreError)
        throw new Error(`Cannot restore a parked job: ${restoreError.message}`);
    }
  };
}
