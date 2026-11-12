import { afterEach, expect, it, vi } from "vitest";
import { rateLimit } from "./rate-limit";

afterEach(() => vi.useRealTimers());

it.each(["signIn", "signInCode"] as const)(
  "%s bounds distinct addresses without evicting active limits and reclaims expired addresses",
  async (kind) => {
    vi.resetModules();
    const { rateLimit: limited } = await import("./rate-limit");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    for (let i = 0; i < 10_000; i++) {
      expect(limited(`address-${i}@example.test`, kind)).toEqual({ ok: true });
    }
    for (let i = 1; i < 5; i++) {
      expect(limited("address-0@example.test", kind)).toEqual({ ok: true });
    }
    expect(limited("overflow@example.test", kind)).toEqual({
      ok: false,
      retryAfter: 900,
    });
    expect(limited("address-0@example.test", kind)).toEqual({
      ok: false,
      retryAfter: 900,
    });
    vi.advanceTimersByTime(899_000);
    expect(limited("address-1@example.test", kind)).toEqual({ ok: true });
    expect(limited("overflow@example.test", kind)).toEqual({
      ok: false,
      retryAfter: 1,
    });
    vi.advanceTimersByTime(1000);
    // Different addresses must reclaim all expired keys, not just their own key.
    for (let i = 0; i < 9_999; i++) {
      expect(limited(`replacement-${i}@example.test`, kind)).toEqual({
        ok: true,
      });
    }
    expect(limited("overflow@example.test", kind)).toEqual({
      ok: false,
      retryAfter: 899,
    });
  },
);

it("the sliding window allows 60 reads per minute", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
  for (let i = 0; i < 60; i++)
    expect(rateLimit("reader", "read")).toEqual({ ok: true });
  expect(rateLimit("reader", "read")).toEqual({ ok: false, retryAfter: 60 });
  vi.advanceTimersByTime(59_001);
  expect(rateLimit("reader", "read")).toEqual({ ok: false, retryAfter: 1 });
  vi.advanceTimersByTime(999);
  expect(rateLimit("reader", "read")).toEqual({ ok: true });
});

it("limits writes and reservations separately by key", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
  for (let i = 0; i < 10; i++)
    expect(rateLimit("writer", "write").ok).toBe(true);
  expect(rateLimit("writer", "write")).toEqual({ ok: false, retryAfter: 60 });
  expect(rateLimit("writer", "read")).toEqual({ ok: true });
  expect(rateLimit("other", "write")).toEqual({ ok: true });
  for (let i = 0; i < 20; i++)
    expect(rateLimit("writer", "reservation").ok).toBe(true);
  expect(rateLimit("writer", "reservation")).toEqual({
    ok: false,
    retryAfter: 3600,
  });
});
