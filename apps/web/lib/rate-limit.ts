// A small in-memory limiter: at most `max` takes per key in a sliding window. It is a guard
// against a runaway client, not a security boundary (each server instance counts on its own).
export function createLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now,
) {
  const hits = new Map<string, number[]>();
  return {
    take(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      hits.set(key, [...recent, t]);
      return true;
    },
  };
}
