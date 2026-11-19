import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { comfyConfig } from "../src/comfy/config.js";
import { workerPaths } from "../src/paths.js";

const same = (a: string, b: string) =>
  expect(resolve(a).toLowerCase()).toBe(resolve(b).toLowerCase());

describe("worker paths", () => {
  it("resolves on production's root exactly the paths production always used", () => {
    for (const env of [{}, { MELLODIFAI_ROOT: "E:\\mellodifai" }]) {
      const paths = workerPaths(env);
      expect(paths.production).toBe(true);
      same(paths.engineRoot, "C:\\Users\\Asus\\Documents\\suno-remake");
      same(paths.renderTmp, "E:/mellodifai/render-tmp");
      same(
        paths.whisperPython,
        "E:/mellodifai/venvs/karaoke-whisper/Scripts/python",
      );
      same(
        paths.stemsPython,
        "E:/suno-remake-archive/.venv-stems/Scripts/python",
      );
      same(
        join(paths.stateDir, "lyrics.json"),
        "E:\\mellodifai\\state\\lyrics.json",
      );
      same(
        paths.legacyVersions,
        "C:\\Users\\Asus\\Documents\\suno-remake\\versions",
      );
      same(paths.legacyFinal, "E:\\suno-remake-render\\out\\final");
      const comfy = comfyConfig(paths.root);
      same(comfy.root, "E:\\mellodifai\\ComfyUI_windows_portable");
      same(comfy.dataDir, "E:\\mellodifai\\comfy-data");
      same(comfy.logFile, "E:\\mellodifai\\comfy-data\\comfy.log");
      same(comfy.pidFile, "E:\\mellodifai\\state\\comfy.pid");
    }
    // An explicit engine root still wins, as before.
    same(
      workerPaths({ MELLODIFAI_ENGINE_ROOT: "F:/engine" }).engineRoot,
      "F:/engine",
    );
  });

  it("keeps every path of another root (the desktop app) under that root", () => {
    const root = "F:\\MellodifAI-App\\data";
    const paths = workerPaths({ MELLODIFAI_ROOT: root });
    expect(paths.production).toBe(false);
    const comfy = comfyConfig(root);
    for (const path of [
      paths.engineRoot,
      paths.stateDir,
      paths.renderTmp,
      paths.whisperPython,
      paths.stemsPython,
      paths.legacyVersions,
      paths.legacyFinal,
      comfy.root,
      comfy.dataDir,
      comfy.logFile,
      comfy.pidFile,
    ])
      expect(relative(root, path).startsWith("..")).toBe(false);
  });
});

describe("worker source", () => {
  it("writes no drive path anywhere but production-paths.ts (and Windows' own fonts)", () => {
    const src = fileURLToPath(new URL("../src/", import.meta.url));
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|mts|mjs|js|py|sh|ps1|json)$/u.test(entry.name)) {
          if (relative(src, path) === "production-paths.ts") continue;
          readFileSync(path, "utf8")
            .split(/\r?\n/u)
            .forEach((line, index) => {
              const hits =
                line.match(
                  /\b[A-Za-z]:(\\\\|\\|\/)[\w.-]+(\\\\|\\|\/)[^"'`\s]*/gu,
                ) ?? [];
              for (const hit of hits)
                if (!/^C:(\\\\|\\|\/)Windows(\\\\|\\|\/)Fonts/iu.test(hit))
                  found.push(`${relative(src, path)}:${index + 1} ${hit}`);
            });
        }
      }
    };
    walk(src);
    expect(found).toEqual([]);
  });
});
