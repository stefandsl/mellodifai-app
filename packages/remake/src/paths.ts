// Runtime locations (design 8.4 and 14.3): everything the engine writes lives under the
// runtime root (MELLODIFAI_ROOT, default E:/mellodifai), never on C:.
export function runtimeRoot(): string {
  return (process.env.MELLODIFAI_ROOT ?? "E:/mellodifai").replaceAll("\\", "/");
}

export function remakesRoot(): string {
  return `${runtimeRoot()}/remakes`;
}

export const ENGINE_ROOT = (
  process.env.REMAKE_ENGINE_ROOT ?? "C:/Users/Asus/Documents/suno-remake"
).replaceAll("\\", "/");
// Demucs and beat_this (the worker's stems venv, CPU torch build).
export const STEMS_PYTHON = (
  process.env.REMAKE_STEMS_PYTHON ??
  "E:/suno-remake-archive/.venv-stems/Scripts/python.exe"
).replaceAll("\\", "/");
// System Python with librosa, for the engine tools and music.py.
export const PYTHON = process.env.REMAKE_PYTHON ?? "python";
