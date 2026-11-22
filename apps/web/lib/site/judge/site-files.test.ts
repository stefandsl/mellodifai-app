import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCss, checkTsx } from "./tokens";

// The token judge on the real files of the public site.
const WEB = join(import.meta.dirname, "../../..");
const SITE_DIRS = ["app/(site)", "components/site"];

function files(dir: string): string[] {
  return readdirSync(join(WEB, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe("site files read every colour, size and spacing from a token", () => {
  const all = SITE_DIRS.flatMap(files);
  it("finds the site files", () => {
    expect(all.some((f) => f.endsWith("site.css"))).toBe(true);
    expect(all.filter((f) => f.endsWith(".tsx")).length).toBeGreaterThanOrEqual(
      8,
    );
  });
  it("has no hand-written value and no raw element where a component exists", () => {
    const violations = all.flatMap((f) => {
      const text = readFileSync(join(WEB, f), "utf8");
      const name = relative(WEB, join(WEB, f)).replaceAll("\\", "/");
      if (f.endsWith(".css")) return checkCss(name, text);
      if (f.endsWith(".tsx")) return checkTsx(name, text);
      return [];
    });
    expect(
      violations.map((v) => `${v.file}:${v.line} ${v.rule}: ${v.text}`),
    ).toEqual([]);
  });
});
