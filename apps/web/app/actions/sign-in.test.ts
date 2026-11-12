// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  headers: new Headers(),
  send: vi.fn(),
  verify: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => mock.headers }));
vi.mock("next/navigation", () => ({ redirect: mock.redirect }));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "it" }));
vi.mock("@/lib/ops/context", () => ({ sessionCtx: mock.session }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithOtp: mock.send, verifyOtp: mock.verify },
  }),
}));

import { sendSignInLink, verifySignInCode } from "./sign-in";

let sequence = 0;
let email: string;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SITE_URL", "http://127.0.0.1:3001");
  mock.headers = new Headers({
    origin: "http://localhost:3001",
    host: "localhost:3001",
  });
  mock.send.mockResolvedValue({ error: null });
  mock.verify.mockResolvedValue({ error: null });
  mock.session.mockRejectedValue(new Error("No session"));
  email = `person-${sequence++}@example.test`;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("sends on the server without a session, signup or an arbitrary redirect", async () => {
  expect(await sendSignInLink(email, "/library")).toEqual({ ok: true });
  expect(mock.send).toHaveBeenCalledWith({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: "http://localhost:3001/auth/confirm?next=%2Flibrary",
    },
  });
  expect(mock.session).not.toHaveBeenCalled();
});

it("returns the same answer for allowlisted, refused and upstream-limited emails", async () => {
  for (const error of [
    null,
    { code: "signup_disabled" },
    { status: 429 },
    { status: 503 },
  ]) {
    mock.send.mockResolvedValue({ error });
    expect(await sendSignInLink(email, "/create")).toEqual({ ok: true });
  }
  mock.send.mockRejectedValue(new Error("transport"));
  expect(await sendSignInLink(email, "/create")).toEqual({ ok: true });
});

it("limits normalized emails to five send attempts per fifteen minutes", async () => {
  vi.useFakeTimers();
  for (let i = 0; i < 5; i++)
    expect((await sendSignInLink(email, "/create")).ok).toBe(true);
  expect(
    await sendSignInLink(` ${email.toUpperCase()} `, "/create"),
  ).toMatchObject({ ok: false, code: "rate_limited" });
  expect(mock.send).toHaveBeenCalledTimes(5);
  vi.advanceTimersByTime(15 * 60_000);
  expect((await sendSignInLink(email, "/create")).ok).toBe(true);
});

it("refuses invalid input and an unapproved local origin before sending", async () => {
  expect(await sendSignInLink("not-email", "/create")).toMatchObject({
    ok: false,
    code: "validation",
  });
  mock.headers.set("origin", "http://localhost:4000");
  expect((await sendSignInLink(email, "/create")).ok).toBe(false);
  expect(mock.send).not.toHaveBeenCalled();
});

it("remote sign-in uses SITE_URL and a validated consent next", async () => {
  vi.stubEnv("SITE_URL", "https://app.mellodifai.com");
  mock.headers.set("x-mdf-remote", "1");
  expect(await sendSignInLink(email, "/consent?uid=flow")).toEqual({
    ok: true,
  });
  expect(mock.send.mock.calls[0][0].options.emailRedirectTo).toBe(
    "https://app.mellodifai.com/auth/confirm?next=%2Fconsent%3Fuid%3Dflow",
  );
  await sendSignInLink(email, "https://evil.test");
  expect(mock.send.mock.calls[1][0].options.emailRedirectTo).toBe(
    "https://app.mellodifai.com/auth/confirm?next=%2Flogin",
  );
});

it("verifies a six-digit email OTP without a session and redirects safely", async () => {
  await verifySignInCode(email, "123456", "/library");
  expect(mock.verify).toHaveBeenCalledWith({
    email,
    token: "123456",
    type: "email",
  });
  expect(mock.redirect).toHaveBeenCalledWith("/library");
  expect(mock.session).not.toHaveBeenCalled();
});

it("remote code verification permits only consent navigation", async () => {
  mock.headers.set("x-mdf-remote", "1");
  await verifySignInCode(email, "123456", "/library");
  expect(mock.redirect).toHaveBeenCalledWith("/login");
});

it("validates and rate limits code guesses separately from sending", async () => {
  expect(await verifySignInCode(email, "12345", "/create")).toMatchObject({
    ok: false,
    code: "validation",
  });
  expect(mock.verify).not.toHaveBeenCalled();
  mock.verify.mockResolvedValue({ error: { message: "invalid" } });
  for (let i = 0; i < 5; i++)
    expect(await verifySignInCode(email, "123456", "/create")).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
  expect(await verifySignInCode(email, "123456", "/create")).toMatchObject({
    ok: false,
    code: "rate_limited",
  });
  expect(await sendSignInLink(email, "/create")).toEqual({ ok: true });
  expect(mock.redirect).not.toHaveBeenCalled();
});
