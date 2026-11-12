import { expect, it } from "vitest";
import { isRemote } from "./remote";

it.each([
  ["x-mdf-remote", "1"],
  ["cf-connecting-ip", "203.0.113.1"],
  ["cf-ray", "ray"],
  ["CF-Ray", ""],
  ["cf-connecting-ip", ""],
])("isRemote is true for %s", (name, value) => {
  expect(isRemote(new Headers({ [name]: value }))).toBe(true);
});

it.each<HeadersInit>([
  {},
  { "x-mdf-remote": "0" },
  { host: "app.mellodifai.com" },
])("does not infer remote from other values or the hostname", (headers) => {
  expect(isRemote(new Headers(headers))).toBe(false);
});
