// Per-process sliding windows guard against runaway callers; the database holds daily tool limits.
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
