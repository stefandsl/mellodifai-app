import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { findMakensis, fontsSource, versionName } from "../src/build.mjs";
import { decodePng, ICON_SIZES, pngToIco, resize } from "../src/icon.mjs";
import {
  childEnv,
  desktopCommand,
  installArgs,
  layout,
  removableData,
  shouldPause,
} from "../src/run.mjs";

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** A PNG using every filter type, so the decoder's predictors are exercised. */
function png(width, height, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const stride = width * 4;
  const plain = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) plain.set(pixel(x, y), (y * width + x) * 4);
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? plain[y * stride + x - 4] : 0;
      const b = y > 0 ? plain[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? plain[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][filter];
      raw[y * (stride + 1) + 1 + x] =
        (plain[y * stride + x] - predictor) & 0xff;
    }
  }
  return {
    file: Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
    plain,
  };
}

describe("icon", () => {
  const pixel = (x, y) => [x * 7, y * 5, (x + y) * 3, x < 2 ? 0 : 255];

  it("decodes all five PNG filters exactly", () => {
    const { file, plain } = png(10, 10, pixel);
    const image = decodePng(file);
    expect([image.width, image.height]).toEqual([10, 10]);
    expect(Buffer.compare(image.pixels, plain)).toBe(0);
  });

  it("writes only classic DIB entries, which NSIS keeps", () => {
    const { file } = png(64, 64, pixel);
    const ico = pngToIco(file, [32, 16]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    for (let index = 0; index < 2; index++) {
      const size = ico.readUInt32LE(6 + index * 16 + 8);
      const offset = ico.readUInt32LE(6 + index * 16 + 12);
      expect(ico.readUInt32LE(offset)).toBe(40); // BITMAPINFOHEADER, not a PNG signature
      expect(ico.readUInt16LE(offset + 14)).toBe(32);
      expect(offset + size).toBeLessThanOrEqual(ico.length);
    }
    expect(ico[6]).toBe(32);
  });

  it("marks transparent pixels in the AND mask and stores 256 as 0", () => {
    const { file } = png(256, 256, pixel);
    const ico = pngToIco(file, [256]);
    expect(ico[6]).toBe(0);
    const offset = ico.readUInt32LE(18);
    const maskStart = offset + 40 + 256 * 256 * 4;
    // Bottom-up rows: the first mask byte is the last image row, x 0..7; x 0-1 are transparent.
    expect(ico[maskStart]).toBe(0b11000000);
  });

  it("averages without darkening transparent edges", () => {
    const image = {
      width: 2,
      height: 1,
      pixels: Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]),
    };
    expect([...resize(image, 1).pixels]).toEqual([255, 0, 0, 128]);
  });

  it("builds the shipped icon from the app's logo at every size", () => {
    const logo = readFileSync(
      new URL("../../web/app/icon.png", import.meta.url),
    );
    const ico = pngToIco(logo);
    expect(ico.readUInt16LE(4)).toBe(ICON_SIZES.length);
  });
});

describe("shortcut shim", () => {
  const here = "E:\\MellodifAI\\app\\apps\\windows\\src";
  const paths = layout(here);

  it("deletes data only inside a real install, never elsewhere", () => {
    const install = mkdtempSync(join(tmpdir(), "mdf-win-"));
    const real = layout(join(install, "app", "apps", "windows", "src"));
    // No shipped run.mjs next to it: not an install, refuse.
    expect(removableData(real)).toBe(false);
    mkdirSync(join(install, "app", "apps", "windows", "src"), {
      recursive: true,
    });
    writeFileSync(
      join(install, "app", "apps", "windows", "src", "run.mjs"),
      "",
    );
    expect(removableData(real)).toBe(true);
    expect(removableData({ ...real, data: join(install, "app") })).toBe(false);
    expect(removableData({ ...real, data: join(install, "..", "data") })).toBe(
      false,
    );
    expect(removableData(layout("E:\\app\\apps\\windows\\src"))).toBe(false);
  });

  it("finds the install, app and data folders from its own location", () => {
    expect(paths).toEqual({
      install: "E:\\MellodifAI",
      app: "E:\\MellodifAI\\app",
      data: "E:\\MellodifAI\\data",
      pnpm: "E:\\MellodifAI\\pnpm\\bin\\pnpm.cjs",
      desktop: "E:\\MellodifAI\\app\\ops\\desktop.ts",
    });
  });

  it("keeps every cache, temp file and the data root inside the install", () => {
    const env = childEnv(paths, {
      PATH: "C:\\Windows",
      MELLODIFAI_ROOT: "E:\\mellodifai",
    });
    expect(env.MELLODIFAI_ROOT).toBe(paths.data);
    // Never Docker: the app's stack is always the native runtime.
    expect(env.MELLODIFAI_RUNTIME).toBe("native");
    for (const name of [
      "TEMP",
      "TMP",
      "TMPDIR",
      "npm_config_cache",
      "npm_config_store_dir",
    ])
      expect(env[name].startsWith(paths.data)).toBe(true);
    expect(env.PATH.endsWith(";C:\\Windows")).toBe(true);
  });

  it("moves Go, npm, pnpm and XDG caches off the owner's own settings (often on C:)", () => {
    const parent = {
      PATH: "C:\\Windows",
      GOPATH: "C:\\Users\\o\\go",
      GOCACHE: "C:\\Users\\o\\AppData\\Local\\go-build",
      GOMODCACHE: "C:\\Users\\o\\go\\pkg\\mod",
      NPM_CONFIG_CACHE: "C:\\Users\\o\\npm-cache",
      Npm_Config_Store_Dir: "C:\\pnpm-store",
      XDG_CACHE_HOME: "C:\\cache",
    };
    const env = childEnv(paths, parent);
    const cases = new Map();
    for (const [name, value] of Object.entries(env)) {
      const key = name.toUpperCase();
      // Windows names ignore case: two spellings would leave the choice to chance.
      expect(cases.has(key)).toBe(false);
      cases.set(key, value);
    }
    for (const name of [
      "GOPATH",
      "GOCACHE",
      "GOMODCACHE",
      "NPM_CONFIG_CACHE",
      "NPM_CONFIG_STORE_DIR",
      "XDG_CACHE_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "XDG_CONFIG_HOME",
    ])
      expect(cases.get(name)?.startsWith(paths.data)).toBe(true);
  });

  it("installs from the lockfile without running package scripts", () => {
    const args = installArgs(paths);
    expect(args[0]).toBe(paths.pnpm);
    expect(args).toEqual(
      expect.arrayContaining([
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
      ]),
    );
    expect(args[args.indexOf("--store-dir") + 1]).toBe(
      join(paths.data, "cache", "pnpm"),
    );
  });

  it("turns the installer's step into setup for a new install and update otherwise", () => {
    expect(desktopCommand("install", ["--email", "a@b.it"], false)).toEqual([
      "setup",
      "--email",
      "a@b.it",
    ]);
    expect(
      desktopCommand("install", ["--email", "a@b.it", "--no-browser"], true),
    ).toEqual(["update", "--no-browser"]);
    expect(desktopCommand("stop", [], true)).toEqual(["stop"]);
  });

  it("keeps a window open for errors and results, never at logon", () => {
    expect(shouldPause("start", 1, true)).toBe(true);
    expect(shouldPause("start", 0, true)).toBe(false);
    expect(shouldPause("status", 0, true)).toBe(true);
    expect(shouldPause("autostart", 1, true)).toBe(false);
    expect(shouldPause("start", 1, false)).toBe(false);
    // A console opened by a silent installer looks interactive; it must never wait.
    expect(shouldPause("install", 1, true, ["--unattended"])).toBe(false);
    expect(
      desktopCommand("install", ["--email", "a@b.it", "--unattended"], false),
    ).toEqual(["setup", "--email", "a@b.it"]);
  });
});

describe("installer build", () => {
  it("makes a file-safe version name", () => {
    expect(versionName("agent-remake-20261110-r1-5-gabc1234")).toBe(
      "agent-remake-20261110-r1-5-gabc1234",
    );
    expect(versionName("v1 2/3\n")).toBe("v1-2-3");
    expect(versionName("", new Date("2026-11-13T00:00:00Z"))).toBe(
      "2026-11-13",
    );
  });

  it("ships the worker's fonts and refuses a folder without every language", () => {
    const all = new Set(
      ["ja", "ko", "zh"].map((lang) => join("F:/fonts", lang, "LICENSES.txt")),
    );
    const exists = (path) => all.has(path);
    expect(fontsSource({ MELLODIFAI_FONTS: "F:/fonts" }, exists)).toBe(
      "F:/fonts",
    );
    expect(fontsSource({ MELLODIFAI_ROOT: "F:/" }, exists)).toBe(
      join("F:/", "fonts"),
    );
    all.delete(join("F:/fonts", "zh", "LICENSES.txt"));
    expect(() => fontsSource({ MELLODIFAI_FONTS: "F:/fonts" }, exists)).toThrow(
      /Fonts missing/,
    );
  });

  it("prefers MAKENSIS, then the electron-builder cache", () => {
    const files = new Set([
      "X:\\nsis\\makensis.exe",
      "L:\\electron-builder\\Cache\\nsis",
      "L:\\electron-builder\\Cache\\nsis\\nsis-3.0.4.1",
      "L:\\electron-builder\\Cache\\nsis\\nsis-3.0.4.1\\Bin\\makensis.exe",
    ]);
    const exists = (path) => files.has(path);
    const list = () => ["nsis-3.0.4.1", "nsis-resources-3.4.1"];
    expect(
      findMakensis({ MAKENSIS: "X:\\nsis\\makensis.exe" }, exists, list),
    ).toBe("X:\\nsis\\makensis.exe");
    expect(findMakensis({ LOCALAPPDATA: "L:" }, exists, list)).toBe(
      "L:\\electron-builder\\Cache\\nsis\\nsis-3.0.4.1\\Bin\\makensis.exe",
    );
  });

  it("points every shortcut at the shim the package ships", () => {
    const script = readFileSync(
      new URL("../installer.nsi", import.meta.url),
      "utf8",
    );
    expect(script).toContain('"$INSTDIR\\app\\apps\\windows\\src\\run.mjs"');
    expect(script).toContain("RequestExecutionLevel user");
    for (const command of [
      "start",
      "stop",
      "backup",
      "restore",
      "status",
      "autostart",
    ])
      expect(script).toContain(`'\${RUN} ${command}'`);
    // Data is removed only when the owner says so.
    expect(script).toMatch(/MB_DEFBUTTON2[^\n]*IDNO keep_data/);
    // The silent install runs unattended, and same-named links of the owner's survive.
    expect(script).toMatch(
      /\$\{If\} \$\{Silent\}\s+ExecWait[^\n]*--unattended/,
    );
    expect(script).toContain('StrCpy $3 "MellodifAI app.lnk"');
    // A hung Docker CLI once kept the old version's stop running for 6.5 hours.
    const calls = script.match(/nsExec::ExecToLog[^\r\n]*/g) ?? [];
    expect(calls.length).toBe(3);
    for (const call of calls) expect(call).toContain("/TIMEOUT=");
    expect(script).not.toContain('Delete "$DESKTOP\\MellodifAI.lnk"');
  });
});
