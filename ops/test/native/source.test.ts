import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { prepareNativeSource } from "../../lib/native/source.js";
import { testTempBase } from "../temp-base.js";

it("stages native templates without replacing existing CLI source entries", () => {
  const root = mkdtempSync(join(testTempBase(), "native-source-test-"));
  try {
    const target = join(root, "stack");
    const source = join(root, "release");
    mkdirSync(join(target, "supabase"), { recursive: true });
    writeFileSync(
      join(target, "supabase/migrations"),
      "preserve existing CLI source",
    );
    mkdirSync(join(source, "supabase/templates"), { recursive: true });
    writeFileSync(
      join(source, "supabase/templates/magic_link.html"),
      "reviewed template",
    );
    prepareNativeSource(target, source);
    expect(readFileSync(join(target, "supabase/migrations"), "utf8")).toBe(
      "preserve existing CLI source",
    );
    expect(
      readFileSync(join(target, "compose/templates/magic_link.html"), "utf8"),
    ).toBe("reviewed template");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
