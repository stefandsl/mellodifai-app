// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  formatStripReport,
  judgeStrips,
  resolveCraftCli,
} from "./judge-strips.mjs";
import { diffLayouts, loadLayoutRef } from "./layout-diff.mjs";
import {
  encodePng,
  renderStrip,
  STRIP_H,
  waitForPageReady,
  writeStripsForRef,
} from "./measure.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const WEB_DIR = resolve(HERE, "../..");
const LAYOUT_REF_DIR = join(WEB_DIR, "e2e", "site", "layout-ref");
const LAYOUT_DIFF_SCRIPT = join(HERE, "layout-diff.mjs");
const JUDGE_STRIPS_SCRIPT = join(HERE, "judge-strips.mjs");

const TMP_ROOT = join(
  process.env.RUNNER_TEMP || process.env.TEMP || process.env.TMP || tmpdir(),
  "t26-j2-tests",
);
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Write a deterministic local implementation of the `web-pixels-compare` JSON protocol
 * that decodes two 8-bit RGB PNGs with zlib and computes comparable, difference_fraction,
 * and changed_bounding_box. Used so unit tests run identically on CI without an external binary.
 */
function writePixelCompareStub(dir: string): string {
  const scriptPath = join(dir, "pixel-compare-stub.mjs");
  writeFileSync(
    scriptPath,
    `import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function decodePng(filePath) {
  const buf = readFileSync(filePath);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idats = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idats));
  const stride = width * 3 + 1;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    if (raw[y * stride] !== 0) throw new Error("unsupported filter");
    rgb.set(raw.subarray(y * stride + 1, y * stride + 1 + width * 3), y * width * 3);
  }
  return { width, height, rgb };
}

const jsonIdx = process.argv.indexOf("--json");
const req = JSON.parse(process.argv[jsonIdx + 1]);
const a = decodePng(req.before.path);
const b = decodePng(req.after.path);
const tol = Number(req.tolerance ?? 8);
if (a.width !== b.width || a.height !== b.height) {
  console.log(JSON.stringify({ result: { comparable: false, difference_fraction: 1, changed_bounding_box: null } }));
  process.exit(0);
}
let changed = 0;
let minX = a.width;
let minY = a.height;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < a.height; y += 1) {
  for (let x = 0; x < a.width; x += 1) {
    const o = (y * a.width + x) * 3;
    const d = Math.max(
      Math.abs(a.rgb[o] - b.rgb[o]),
      Math.abs(a.rgb[o + 1] - b.rgb[o + 1]),
      Math.abs(a.rgb[o + 2] - b.rgb[o + 2]),
    );
    if (d > tol) {
      changed += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
const total = a.width * a.height;
const changed_bounding_box =
  changed > 0
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null;
console.log(
  JSON.stringify({
    result: {
      comparable: true,
      difference_fraction: changed / total,
      changed_bounding_box,
    },
  }),
);
`,
  );
  return scriptPath;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("site-study J1 layout-diff.mjs and J2 judge-strips.mjs", () => {
  const pricingRefPath = join(LAYOUT_REF_DIR, "pricing.json");

  it("renders deterministic grey strips that change when a layout value is mutated", () => {
    const { data } = loadLayoutRef(pricingRefPath);
    const sec1 = data.widths["1440"].sections[1];
    const pxA = renderStrip(sec1, 1440);
    const pxB = renderStrip(sec1, 1440);
    expect(pxA.length).toBe(1440 * STRIP_H);
    expect(
      Buffer.compare(
        encodePng(1440, STRIP_H, pxA),
        encodePng(1440, STRIP_H, pxB),
      ),
    ).toBe(0);

    const mutated = structuredClone(sec1);
    mutated.grid.perRow = 3;
    const pxMut = renderStrip(mutated, 1440);
    let diffPixels = 0;
    for (let i = 0; i < pxA.length; i += 1) {
      if (pxA[i] !== pxMut[i]) diffPixels += 1;
    }
    expect(diffPixels / pxA.length).toBeGreaterThan(0.01);
  });

  it("layout-diff.mjs passes identical refs and exits non-zero when one reference value changes", () => {
    const dir = makeTempDir("diff-");
    const { data } = loadLayoutRef(pricingRefPath);
    const samePath = join(dir, "same.json");
    writeFileSync(samePath, JSON.stringify(data, null, 2));

    const ok = diffLayouts(data, data, { px: 4 });
    expect(ok.pass).toBe(true);
    expect(ok.failures).toEqual([]);

    const okCli = spawnSync(
      process.execPath,
      [LAYOUT_DIFF_SCRIPT, pricingRefPath, samePath, "--px=4"],
      { encoding: "utf8" },
    );
    expect(okCli.status).toBe(0);
    expect(okCli.stdout).toContain("PASSED: every value within 4 px");

    const mutated = structuredClone(data);
    mutated.widths["1440"].sections[1].contentLeft += 12;
    const mutatedPath = join(dir, "mutated.json");
    writeFileSync(mutatedPath, JSON.stringify(mutated, null, 2));

    const bad = diffLayouts(data, mutated, { px: 4 });
    expect(bad.pass).toBe(false);
    expect(bad.failures).toHaveLength(1);
    expect(bad.failures[0]).toContain("contentLeft");

    const badCli = spawnSync(
      process.execPath,
      [LAYOUT_DIFF_SCRIPT, pricingRefPath, mutatedPath, "--px=4"],
      { encoding: "utf8" },
    );
    expect(badCli.status).toBe(1);
    expect(badCli.stdout).toContain("FAIL");
    expect(badCli.stdout).toContain("FAILED: 1 differences over 4 px");
  });

  it("judge-strips.mjs passes on unchanged reference and fails when one reference value is changed", {
    timeout: 30_000,
  }, () => {
    const dir = makeTempDir("j2-");
    const stubCli = writePixelCompareStub(dir);
    const { data } = loadLayoutRef(pricingRefPath);

    // Use a focused 1440 slice (Head + Plan cards grid) from pricing.json so the
    // subprocess-heavy CLI test stays fast on Windows while still exercising real PNG diffs.
    const slice = {
      slug: data.slug,
      route: data.route,
      sections: data.sections.slice(0, 2),
      widths: {
        "1440": {
          pageHeight: data.widths["1440"].pageHeight,
          sections: data.widths["1440"].sections.slice(0, 2),
        },
      },
    };

    const refDir = join(dir, "ref");
    const sameDir = join(dir, "same");
    const mutatedDir = join(dir, "mutated");
    mkdirSync(refDir, { recursive: true });
    mkdirSync(sameDir, { recursive: true });
    mkdirSync(mutatedDir, { recursive: true });

    const refJsonPath = join(dir, "pricing-slice.json");
    writeFileSync(refJsonPath, JSON.stringify(slice, null, 2));
    writeFileSync(
      join(refDir, "layout-ref.json"),
      JSON.stringify(slice, null, 2),
    );
    writeStripsForRef(slice, refDir);
    writeFileSync(
      join(sameDir, "layout-ref.json"),
      JSON.stringify(slice, null, 2),
    );
    writeStripsForRef(slice, sameDir);

    const passRes = judgeStrips({
      refPath: refDir,
      candPath: sameDir,
      max: 0.01,
      tolerance: 8,
      cli: stubCli,
      tempBase: dir,
    });
    expect(passRes.pass).toBe(true);
    expect(passRes.failed).toBe(0);
    expect(passRes.worstFraction).toBe(0);

    // Mutate one reference value: reduce 1440 plan grid from 4 items per row to 3.
    const mutated = structuredClone(slice);
    mutated.widths["1440"].sections[1].grid.perRow = 3;
    writeFileSync(
      join(mutatedDir, "layout-ref.json"),
      JSON.stringify(mutated, null, 2),
    );
    writeStripsForRef(mutated, mutatedDir);

    const failRes = judgeStrips({
      refPath: refJsonPath,
      candPath: mutatedDir,
      max: 0.01,
      tolerance: 8,
      cli: stubCli,
      tempBase: dir,
    });
    expect(failRes.pass).toBe(false);
    expect(failRes.failed).toBe(1);
    expect(failRes.worstFraction).toBeGreaterThan(0.01);
    expect(formatStripReport(failRes)).toContain("1440 #01 FAIL");
    expect(formatStripReport(failRes)).toContain("FAILED: 1");

    // Verify CLI exit code is 0 on pass and 1 on mutated reference.
    const passCli = spawnSync(
      process.execPath,
      [
        JUDGE_STRIPS_SCRIPT,
        refJsonPath,
        sameDir,
        "--max=0.01",
        "--tolerance=8",
        `--cli=${stubCli}`,
      ],
      { encoding: "utf8" },
    );
    expect(passCli.status).toBe(0);
    expect(passCli.stdout).toContain("PASSED");

    const failCli = spawnSync(
      process.execPath,
      [
        JUDGE_STRIPS_SCRIPT,
        refJsonPath,
        mutatedDir,
        "--max=0.01",
        "--tolerance=8",
        `--cli=${stubCli}`,
      ],
      { encoding: "utf8" },
    );
    expect(failCli.status).toBe(1);
    expect(failCli.stdout).toContain("1440 #01 FAIL");
    expect(failCli.stdout).toContain("FAILED: 1");
  });

  it("judge-strips.mjs fails clearly when the CLI executable is missing", () => {
    const dir = makeTempDir("missing-cli-");
    expect(resolveCraftCli(join(dir, "does-not-exist.exe"), {})).toBeNull();
    const res = spawnSync(
      process.execPath,
      [
        JUDGE_STRIPS_SCRIPT,
        pricingRefPath,
        pricingRefPath,
        `--cli=${join(dir, "does-not-exist.exe")}`,
      ],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("craft-anything-cli not found");
    expect(res.stderr).toContain("0.6.1");
    expect(res.stderr).toContain("README.md");
  });

  it("measure.mjs warns with width and wait name when page readiness waits time out", async () => {
    const warnings: string[] = [];
    const timeoutErr = (name: string) =>
      new Error(`Timeout 50ms waiting for ${name}`);
    const fakePage = {
      waitForLoadState: () => Promise.reject(timeoutErr("networkidle")),
      evaluate: () => Promise.resolve(undefined),
      locator: (selector: string) => ({
        first: () => ({
          count: () => Promise.resolve(1),
          waitFor: () => Promise.reject(timeoutErr(selector)),
        }),
      }),
      waitForFunction: () => Promise.reject(timeoutErr("hydration")),
    };

    await waitForPageReady(
      fakePage as unknown as import("@playwright/test").Page,
      1440,
      {
        networkIdleTimeout: 50,
        hydrationTimeout: 50,
        warn: (msg: string) => warnings.push(msg),
      },
    );

    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain("width=1440");
    expect(warnings[0]).toContain("networkidle");
    expect(warnings[1]).toContain("width=1440");
    expect(warnings[1]).toContain("header attached");
    expect(warnings[2]).toContain("width=1440");
    expect(warnings[2]).toContain("data-scrolled");
    expect(warnings[3]).toContain("width=1440");
    expect(warnings[3]).toContain("data-ready");
  });

  const REAL_CRAFT_CLI = process.env.CRAFT_ANYTHING_CLI;
  const hasRealCraftCli = Boolean(REAL_CRAFT_CLI && existsSync(REAL_CRAFT_CLI));

  it.skipIf(!hasRealCraftCli)(
    "runs with the real Craft Anything CLI when CRAFT_ANYTHING_CLI is configured",
    {
      timeout: 30_000,
    },
    () => {
      const realCli = REAL_CRAFT_CLI as string;

      const dir = makeTempDir("real-cli-");
      const { data } = loadLayoutRef(pricingRefPath);

      const passRes = judgeStrips({
        refPath: pricingRefPath,
        candPath: pricingRefPath,
        max: 0.01,
        tolerance: 8,
        cli: realCli,
        tempBase: dir,
      });
      expect(passRes.pass).toBe(true);
      expect(passRes.worstFraction).toBe(0);

      const mutated = structuredClone(data);
      mutated.widths["1440"].sections[1].grid.perRow = 3;
      const mutatedJson = join(dir, "pricing-mutated.json");
      writeFileSync(mutatedJson, JSON.stringify(mutated, null, 2));

      const failRes = judgeStrips({
        refPath: pricingRefPath,
        candPath: mutatedJson,
        max: 0.01,
        tolerance: 8,
        cli: realCli,
        tempBase: dir,
      });
      expect(failRes.pass).toBe(false);
      expect(failRes.failed).toBe(1);
      expect(failRes.worstFraction).toBeGreaterThan(0.01);
    },
  );

  it("always renders strips from layout-ref.json and ignores stale PNGs already in the folder", {
    timeout: 30_000,
  }, () => {
    const dir = makeTempDir("stale-strips-");
    const stubCli = writePixelCompareStub(dir);
    const { data } = loadLayoutRef(pricingRefPath);

    const slice = {
      slug: data.slug,
      route: data.route,
      sections: data.sections.slice(0, 2),
      widths: {
        "1440": {
          pageHeight: data.widths["1440"].pageHeight,
          sections: data.widths["1440"].sections.slice(0, 2),
        },
      },
    };
    const mutated = structuredClone(slice);
    mutated.widths["1440"].sections[1].grid.perRow = 3;

    // Candidate dir has MUTATED layout-ref.json, but stale PNGs drawn from UNCHANGED slice.
    // Reusing stale PNGs would falsely pass; re-rendering from JSON must fail.
    const stalePassDir = join(dir, "stale-pass");
    mkdirSync(stalePassDir, { recursive: true });
    writeFileSync(
      join(stalePassDir, "layout-ref.json"),
      JSON.stringify(mutated, null, 2),
    );
    writeStripsForRef(slice, stalePassDir);

    const refJson = join(dir, "slice.json");
    writeFileSync(refJson, JSON.stringify(slice, null, 2));

    const mustFail = judgeStrips({
      refPath: refJson,
      candPath: stalePassDir,
      max: 0.01,
      tolerance: 8,
      cli: stubCli,
      tempBase: dir,
    });
    expect(mustFail.pass).toBe(false);
    expect(mustFail.failed).toBe(1);

    // Candidate dir has UNCHANGED layout-ref.json, but stale PNGs drawn from MUTATED slice.
    // Reusing stale PNGs would falsely fail; re-rendering from JSON must pass.
    const staleFailDir = join(dir, "stale-fail");
    mkdirSync(staleFailDir, { recursive: true });
    writeFileSync(
      join(staleFailDir, "layout-ref.json"),
      JSON.stringify(slice, null, 2),
    );
    writeStripsForRef(mutated, staleFailDir);

    const mustPass = judgeStrips({
      refPath: refJson,
      candPath: staleFailDir,
      max: 0.01,
      tolerance: 8,
      cli: stubCli,
      tempBase: dir,
    });
    expect(mustPass.pass).toBe(true);
    expect(mustPass.worstFraction).toBe(0);
  });

  it("rejects .cmd and .bat CLI shims with a clear error message", () => {
    const dir = makeTempDir("cmd-shim-");
    const cmdPath = join(dir, "craft-anything-cli.cmd");
    const batPath = join(dir, "craft-anything-cli.bat");
    writeFileSync(cmdPath, "@echo off\r\n");
    writeFileSync(batPath, "@echo off\r\n");

    expect(() => resolveCraftCli(cmdPath, {})).toThrow(/\.cmd|\.bat/iu);
    expect(() => resolveCraftCli(batPath, {})).toThrow(/\.cmd|\.bat/iu);

    const res = spawnSync(
      process.execPath,
      [JUDGE_STRIPS_SCRIPT, pricingRefPath, pricingRefPath, `--cli=${cmdPath}`],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/\.cmd|\.bat/iu);
  });

  it("exits with a usage error when --slug is combined with positional paths", () => {
    const dir = makeTempDir("slug-pos-");
    const stubCli = writePixelCompareStub(dir);
    const res = spawnSync(
      process.execPath,
      [
        JUDGE_STRIPS_SCRIPT,
        "--slug",
        "pricing",
        pricingRefPath,
        pricingRefPath,
        `--cli=${stubCli}`,
      ],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--slug");
  });

  it("recipes layout references have null grid on every canvas section and real grid values in recipes-grid", () => {
    const { data: canvasRef } = loadLayoutRef(
      join(LAYOUT_REF_DIR, "recipes.json"),
    );
    for (const w of ["1440", "1024", "390"]) {
      const sections = canvasRef.widths[w].sections;
      expect(sections.length).toBeGreaterThan(0);
      for (const sec of sections) {
        expect(sec.grid).toBeNull();
      }
    }

    const { data: gridRef } = loadLayoutRef(
      join(LAYOUT_REF_DIR, "recipes-grid.json"),
    );
    expect(gridRef.widths["1440"].sections[1].grid).toMatchObject({
      perRow: 5,
      itemW: 250,
      colGap: 18,
      rowGap: 18,
      x: 60,
      w: 1320,
    });
    expect(gridRef.widths["1024"].sections[1].grid).toMatchObject({
      perRow: 4,
      itemW: 213,
      x: 60,
      w: 904,
    });
    expect(gridRef.widths["390"].sections[1].grid).toMatchObject({
      perRow: 2,
      itemW: 172,
      x: 14,
      w: 362,
    });
  });
});
