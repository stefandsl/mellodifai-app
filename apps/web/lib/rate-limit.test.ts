import { expect, it } from "vitest";
import { createLimiter } from "./rate-limit";

it("allows `max` takes per window, per key, and frees them as time passes", () => {
  let t = 0;
  const limiter = createLimiter(2, 1000, () => t);
  expect(limiter.take("a")).toBe(true);
  expect(limiter.take("a")).toBe(true);
  expect(limiter.take("a")).toBe(false);
  expect(limiter.take("b")).toBe(true);
  t = 999;
  expect(limiter.take("a")).toBe(false);
  t = 1001;
  expect(limiter.take("a")).toBe(true);
});
