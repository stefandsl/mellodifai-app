import { join, resolve } from "node:path";
import { PRODUCTION } from "./production-paths.js";

// Every on-disk place the worker uses outside a job workspace, from its runtime root
// (RUNNER_TEMP, then MELLODIFAI_ROOT, then production's root) and its engine root
// (MELLODIFAI_ENGINE_ROOT). A worker on production's root resolves exactly the paths it always
// used; any other root (the desktop app, a lab) keeps everything under itself and never
// reaches production's engine, venvs, ComfyUI or state files.
export type WorkerPaths = {
  root: string;
  production: boolean;
  engineRoot: string;
  stateDir: string;
  renderTmp: string;
  whisperPython: string;
  stemsPython: string;
  legacyVersions: string;
  legacyFinal: string;
};

export function runtimeRootFrom(env: NodeJS.ProcessEnv): string {
  return env.RUNNER_TEMP ?? env.MELLODIFAI_ROOT ?? PRODUCTION.root;
}

const key = (path: string) =>
  resolve(path)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();

export function workerPaths(env: NodeJS.ProcessEnv = process.env): WorkerPaths {
  const root = runtimeRootFrom(env);
  const production = key(root) === key(PRODUCTION.root);
  const engineRoot =
    env.MELLODIFAI_ENGINE_ROOT ??
    (production ? PRODUCTION.engineRoot : join(root, "engine"));
  return {
    root,
    production,
    engineRoot,
    stateDir: join(root, "state"),
    renderTmp: join(root, "render-tmp"),
    whisperPython: join(root, "venvs", "karaoke-whisper", "Scripts", "python"),
    stemsPython: production
      ? PRODUCTION.stemsPython
      : join(root, "venvs", "stems", "Scripts", "python"),
    legacyVersions: join(engineRoot, "versions"),
    legacyFinal: production
      ? PRODUCTION.legacyFinal
      : join(root, "legacy", "final"),
  };
}
