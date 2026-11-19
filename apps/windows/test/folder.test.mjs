import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { folderProblem, realFolder } from "../src/folder.mjs";

const base = mkdtempSync(join(tmpdir(), "mdf-folder-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const prod = join(base, "Prod");
mkdirSync(join(prod, "stacks", "prod"), { recursive: true });
const options = { productionRoots: [prod.toUpperCase()], systemDrive: "Q:" };

describe("install folder", () => {
  it("refuses the production root in any letter case", () => {
    expect(folderProblem(prod.toLowerCase(), options)).toMatch(/produzione/);
    expect(folderProblem(join(base, "PROD"), options)).toMatch(/produzione/);
    // A folder that holds the production root is just as bad.
    expect(folderProblem(base, options)).toMatch(/produzione/);
  });

  it.skipIf(process.platform !== "win32")(
    "refuses the production root reached through a junction",
    () => {
      const link = join(base, "looks-new");
      symlinkSync(prod, link, "junction");
      expect(realFolder(link).toLowerCase()).toBe(prod.toLowerCase());
      expect(folderProblem(link, options)).toMatch(/produzione/);
      expect(folderProblem(join(link, "..", "looks-new"), options)).toMatch(
        /produzione/,
      );
    },
  );

  it("refuses a folder with other files, takes an empty, new or own one", () => {
    const busy = join(base, "busy");
    mkdirSync(busy);
    writeFileSync(join(busy, "notes.txt"), "x");
    expect(folderProblem(busy, options)).toMatch(/altri file/);
    const empty = join(base, "empty");
    mkdirSync(empty);
    expect(folderProblem(empty, options)).toBeNull();
    expect(
      folderProblem(join(base, "new", "MellodifAI-App"), options),
    ).toBeNull();
    // An earlier install, or the data its uninstall kept, is this app's own folder.
    const own = join(base, "own");
    mkdirSync(join(own, "data", "config"), { recursive: true });
    writeFileSync(join(own, "data", "config", "owner.json"), "{}");
    expect(folderProblem(own, options)).toBeNull();
  });

  it("refuses the system drive and a drive root", () => {
    expect(
      folderProblem(join(base, "x"), {
        ...options,
        systemDrive: base.slice(0, 2),
      }),
    ).toMatch(/disco di sistema/);
    expect(folderProblem(`${base.slice(0, 2)}\\`, options)).toMatch(/radice/);
  });
});
