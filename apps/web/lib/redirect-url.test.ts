import { expect, it } from "vitest";
import { redirectUrl } from "./redirect-url";

it.each([
  [{ host: "127.0.0.1:3000" }, "http://127.0.0.1:3000/library"],
  [
    {
      host: "localhost:3000",
      "x-forwarded-host": "mellodifai.com",
      "x-forwarded-proto": "https",
    },
    "https://mellodifai.com/library",
  ],
  [
    {
      host: "localhost:3000",
      "x-forwarded-host": "preview.vercel.app, internal",
      "x-forwarded-proto": "https, http",
    },
    "https://preview.vercel.app/library",
  ],
])("uses the external origin from %j", (headers, expected) => {
  const request = new Request("http://localhost:3000/auth/confirm", {
    headers,
  });
  expect(redirectUrl(request, "/library").href).toBe(expected);
});

it("uses the request protocol when no forwarded protocol is supplied", () => {
  const request = new Request("https://internal/auth/confirm", {
    headers: { host: "mellodifai.com" },
  });
  expect(redirectUrl(request, "/login?message=invalid-link").href).toBe(
    "https://mellodifai.com/login?message=invalid-link",
  );
});

it("does not fall back to the normalized request host", () => {
  expect(() =>
    redirectUrl(new Request("http://localhost/"), "/library"),
  ).toThrow("Host header");
});
