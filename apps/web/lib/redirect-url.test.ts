import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { redirectUrl } from "./redirect-url";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mellodifai.com");
});
afterEach(() => vi.unstubAllEnvs());
function target(headers: Record<string, string>) {
  return redirectUrl(new Request("http://internal/", { headers }), "/library")
    .href;
}
it("prioritizes allowed forwarded host and protocol", () => {
  expect(
    target({
      host: "internal",
      "x-forwarded-host": "mellodifai.com, internal",
      "x-forwarded-proto": "https, http",
    }),
  ).toBe("https://mellodifai.com/library");
});
it("falls back to Host and request protocol", () => {
  expect(target({ host: "mellodifai.com" })).toBe(
    "http://mellodifai.com/library",
  );
});
const rejectedHeaders: Record<string, string>[] = [
  {},
  { host: "evil.test" },
  { host: "mellodifai.com@evil.test" },
  { host: "mellodifai.com/path" },
  { host: "[broken" },
  { host: "localhost:4444" },
  { host: "mellodifai.com", "x-forwarded-proto": "javascript" },
  { host: "mellodifai.com", "x-forwarded-proto": "ftp" },
];
it.each(rejectedHeaders)("safely rejects %j", (headers) => {
  expect(target(headers)).toBe("https://mellodifai.com/library");
});
it.each(["localhost:4444", "127.0.0.1:3000", "localhost:80"])(
  "allows development loopback %s",
  (host) => {
    vi.stubEnv("NODE_ENV", "development");
    expect(target({ host })).toBe(new URL(`http://${host}/library`).href);
  },
);
it("uses nextUrl origin with no site config", () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  const request = Object.assign(new Request("http://internal/"), {
    nextUrl: { origin: "https://preview.vercel.app" },
  });
  expect(redirectUrl(request, "/library").href).toBe(
    "https://preview.vercel.app/library",
  );
});
it("handles malformed site config", () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "malformed");
  expect(target({})).toBe("http://internal/library");
});

it.each(["localhost:3000", "127.0.0.1:3000"])(
  "keeps the approved production local origin %s",
  (host) => {
    expect(target({ host })).toBe(`http://${host}/library`);
  },
);
