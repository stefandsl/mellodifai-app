// The owner's PC layout the live site runs on: the only drive paths written in the worker's
// source (test/no-drive-paths.test.ts refuses them anywhere else). A worker uses them only
// when its runtime root is PRODUCTION.root; every other worker (desktop app, labs, CI)
// derives its paths from MELLODIFAI_ROOT and MELLODIFAI_ENGINE_ROOT (paths.ts).
export const PRODUCTION = {
  root: "E:/mellodifai",
  // The engine checkout: tools, versions and publish\ (production's YouTube token).
  engineRoot: "C:\\Users\\Asus\\Documents\\suno-remake",
  // The Demucs venv of the engine's timing pipeline.
  stemsPython: "E:/suno-remake-archive/.venv-stems/Scripts/python",
  // Renders of the old pipeline, read by the one-time legacy import.
  legacyFinal: "E:\\suno-remake-render\\out\\final",
} as const;
