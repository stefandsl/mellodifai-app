import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type PostDraft,
  type ProviderStatus,
  type PublishingProvider,
  YOUTUBE_RULES,
} from "@mellodifai/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

// The app's publishing clock (design 2026-11-19 section 6). Every tick: settle handoffs whose
// lease ran out by the provider's status only, then claim due destinations and run
// claim -> intent -> handoff -> postNow -> finish. The handoff commit is the last moment a veto
// can win; after it only the provider's answer counts, and an uncertain one is never retried.

export type Claim = {
  destination_id: string;
  schedule_id: string;
  claim_token: string;
  attempt_id: string;
  platform: string;
  provider: string;
  external_id: string | null;
  // The uploaded render's file; its folder holds the base thumbnail.
  render_path?: string | null;
  draft?: {
    title: string;
    description: string;
    tags: string[];
    thumbnail_text: string;
  };
};
// A failure the worker stores and the dashboard shows: a short code, never raw provider text.
export class PublishError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}
export const errorCode = (error: unknown) =>
  error instanceof PublishError && /^[a-z][a-z0-9_]{0,63}$/u.test(error.code)
    ? error.code
    : "provider_error";

export type Outcome =
  | "published"
  | "definitely_not_accepted"
  | "failed"
  | "unknown";

export interface DispatchDb {
  recover(worker: string): Promise<Claim[]>;
  claim(worker: string, limit: number): Promise<Claim[]>;
  intent(destination: string, token: string): Promise<boolean>;
  hold(destination: string, token: string, reason: string): Promise<boolean>;
  handoff(destination: string, token: string): Promise<boolean>;
  finish(
    destination: string,
    token: string,
    outcome: Outcome,
    url: string | null,
    error: string | null,
  ): Promise<void>;
}

export function supabaseDispatchDb(client: SupabaseClient): DispatchDb {
  const ops = client.schema("ops");
  const call = async <T>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await ops.rpc(name, args);
    if (error) throw new Error(`${name} failed (${error.code ?? "rpc"})`);
    return data as T;
  };
  return {
    recover: (worker) => call("publish_dispatch_recover", { p_worker: worker }),
    claim: (worker, limit) =>
      call("publish_dispatch_claim", { p_worker: worker, p_limit: limit }),
    intent: (destination, token) =>
      call("publish_dispatch_intent", {
        p_destination: destination,
        p_token: token,
      }),
    hold: (destination, token, reason) =>
      call("publish_dispatch_hold", {
        p_destination: destination,
        p_token: token,
        p_reason: reason,
      }),
    handoff: (destination, token) =>
      call("publish_dispatch_handoff", {
        p_destination: destination,
        p_token: token,
      }),
    finish: async (destination, token, outcome, url, error) => {
      await call("publish_dispatch_finish", {
        p_destination: destination,
        p_token: token,
        p_outcome: outcome,
        p_external_url: url,
        p_error: error,
      });
    },
  };
}

export type Providers = Map<string, PublishingProvider>;
const key = (provider: string, platform: string) => `${provider}:${platform}`;

export function postDraft(claim: Claim): PostDraft {
  return {
    platform: "youtube",
    accountId: "default",
    renderId: "",
    format: "landscape",
    title: claim.draft?.title ?? "",
    caption: claim.draft?.description ?? "",
    hashtags: claim.draft?.tags ?? [],
    thumbnailText: claim.draft?.thumbnail_text ?? "",
    aiGenerated: true,
    madeForKids: false,
    platformExtras: {
      videoId: claim.external_id,
      thumbnail: claim.render_path
        ? join(dirname(claim.render_path), "thumbnail.png")
        : null,
    },
  };
}

const outcomeOf = (status: ProviderStatus): Outcome =>
  status === "published" ||
  status === "definitely_not_accepted" ||
  status === "failed"
    ? status
    : "unknown";

async function statusOf(
  provider: PublishingProvider | undefined,
  claim: Claim,
): Promise<ProviderStatus> {
  if (!provider) return "unknown";
  try {
    return await provider.status(
      claim.attempt_id,
      claim.external_id ?? undefined,
    );
  } catch {
    return "unknown";
  }
}

const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);

export async function dispatchTick(input: {
  db: DispatchDb;
  providers: Providers;
  workerId: string;
  healthy?: () => boolean;
  report?: (line: string) => void;
  // Whether a local file exists (the base thumbnail); tests inject it.
  exists?: (path: string) => Promise<boolean>;
}): Promise<{ checked: number; published: number; skipped: number }> {
  const { db, providers, workerId } = input;
  const report = input.report ?? (() => {});
  const exists =
    input.exists ??
    ((path: string) =>
      access(path).then(
        () => true,
        () => false,
      ));
  let published = 0;
  let skipped = 0;
  const checks = await db.recover(workerId);
  for (const check of checks) {
    const status = await statusOf(
      providers.get(key(check.provider, check.platform)),
      check,
    );
    const outcome = outcomeOf(status);
    await db.finish(
      check.destination_id,
      check.claim_token,
      outcome,
      outcome === "published" && check.external_id
        ? `https://youtu.be/${encodeURIComponent(check.external_id)}`
        : null,
      outcome === "published" ? null : `lost_handoff_${status}`,
    );
    report(`Publish ${check.destination_id}: recovered as ${outcome}`);
  }
  // Fail closed: an unhealthy worker claims nothing, everything stays private.
  if (input.healthy && !input.healthy())
    return { checked: checks.length, published, skipped };
  for (const claim of await db.claim(workerId, 5)) {
    const provider = providers.get(key(claim.provider, claim.platform));
    const draft = postDraft(claim);
    // Unknown provider or a draft the provider refuses: no intent, the lease runs out.
    if (!provider || (await provider.validate(draft, YOUTUBE_RULES)).length) {
      skipped++;
      report(
        `Publish ${claim.destination_id}: skipped, provider or draft not valid`,
      );
      continue;
    }
    // Approved thumbnail text needs its base image on this PC: hold with the reason before the
    // intent, never three refused attempts.
    const base = draft.platformExtras.thumbnail;
    if (
      draft.thumbnailText?.trim() &&
      !(typeof base === "string" && base && (await exists(base)))
    ) {
      await db.hold(claim.destination_id, claim.claim_token, "thumbnail_missing");
      skipped++;
      report(`Publish ${claim.destination_id}: held, base thumbnail missing`);
      continue;
    }
    if (!(await db.intent(claim.destination_id, claim.claim_token))) {
      skipped++;
      continue;
    }
    let media: { mediaRef: string };
    try {
      media = await provider.stageMedia(draft);
    } catch {
      skipped++;
      continue;
    }
    if (!(await db.handoff(claim.destination_id, claim.claim_token))) {
      // A veto won, or the gate failed: nothing was sent.
      skipped++;
      continue;
    }
    try {
      const result = await provider.postNow(draft, media, claim.attempt_id);
      await db.finish(
        claim.destination_id,
        claim.claim_token,
        "published",
        result.url ?? null,
        null,
      );
      published++;
      report(`Publish ${claim.destination_id}: published`);
    } catch (error) {
      // The call may or may not have reached the provider: only its status decides.
      const outcome = outcomeOf(await statusOf(provider, claim));
      await db.finish(
        claim.destination_id,
        claim.claim_token,
        outcome,
        outcome === "published" && claim.external_id
          ? `https://youtu.be/${encodeURIComponent(claim.external_id)}`
          : null,
        outcome === "published" ? null : errorCode(error),
      );
      if (outcome === "published") published++;
      report(`Publish ${claim.destination_id}: ${outcome}`);
    }
  }
  return { checked: checks.length, published, skipped };
}

export function startPublishDispatcher(
  run: () => Promise<unknown>,
  opts: { intervalMs?: number; report?: (line: string) => void } = {},
): () => void {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await run();
    } catch (error) {
      // RPC errors carry codes only (supabaseDispatchDb); never a credential.
      opts.report?.(`Publish dispatcher: ${message(error)}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 30_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
