// Per-process sliding windows guard against runaway callers; the database holds daily tool limits.
const maxKeys = 10_000;
const limits = {
  read: { max: 60, windowMs: 60_000, hits: new Map<string, number[]>() },
  write: { max: 10, windowMs: 60_000, hits: new Map<string, number[]>() },
  reservation: {
    max: 20,
    windowMs: 3_600_000,
    hits: new Map<string, number[]>(),
  },
  signIn: { max: 5, windowMs: 15 * 60_000, hits: new Map<string, number[]>() },
  signInCode: {
    max: 5,
    windowMs: 15 * 60_000,
    hits: new Map<string, number[]>(),
  },
};

export function rateLimit(
  key: string,
  kind: keyof typeof limits,
): { ok: true } | { ok: false; retryAfter: number } {
  const { max, windowMs, hits } = limits[kind];
  const now = Date.now();
  // Reclaim expired identities before admitting new ones at capacity. Never
  // evict an active identity, since that would reset its rate limit.
  if (!hits.has(key) && hits.size >= maxKeys) {
    let earliestExpiry = Number.POSITIVE_INFINITY;
    for (const [identity, timestamps] of hits) {
      const expiresAt = timestamps[timestamps.length - 1] + windowMs;
      if (expiresAt <= now) hits.delete(identity);
      else earliestExpiry = Math.min(earliestExpiry, expiresAt);
    }
    if (hits.size >= maxKeys) {
      return {
        ok: false,
        retryAfter: Math.ceil((earliestExpiry - now) / 1000),
      };
    }
  }
  const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return {
      ok: false,
      retryAfter: Math.ceil((recent[0] + windowMs - now) / 1000),
    };
  }
  hits.set(key, [...recent, now]);
  return { ok: true };
}
