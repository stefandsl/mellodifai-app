import { afterEach, expect, it, vi } from "vitest";
import { rateLimit } from "./rate-limit";

afterEach(() => vi.useRealTimers());

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
