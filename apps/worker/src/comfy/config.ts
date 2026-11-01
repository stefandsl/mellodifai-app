import { join } from "node:path";
import type { Lang, LocalSongEngine } from "@mellodifai/shared";

// The ComfyUI install the bake-off ran on (E:\mellodifai\research\bakeoff\bakeoff.md section 2).
// Everything it writes (outputs, temp, caches, log) stays on E: because C: is nearly full.
export type ComfyConfig = {
  root: string;
  dataDir: string;
  logFile: string;
  pidFile: string;
  host: string;
  port: number;
  // Pinned: the graphs in engines/comfy were validated on this version only.
  version: string;
  startTimeoutMs: number;
};

export const COMFY_CONFIG: ComfyConfig = {
  root: "E:\\mellodifai\\ComfyUI_windows_portable",
  dataDir: "E:\\mellodifai\\comfy-data",
  logFile: "E:\\mellodifai\\comfy-data\\comfy.log",
  pidFile: "E:\\mellodifai\\state\\comfy.pid",
  host: "127.0.0.1",
  port: 8188,
  version: "0.43.0",
  startTimeoutMs: 180_000,
};

export function comfyUrl(config: ComfyConfig): string {
  return `http://${config.host}:${config.port}`;
}
export function comfyOutputDir(config: ComfyConfig): string {
  return join(config.dataDir, "output");
}
export function comfyInputDir(config: ComfyConfig): string {
  return join(config.dataDir, "input");
}

// The launch command of the bake-off (tools/start_comfy.sh, design 5.2), run from the portable root.
export function comfyLaunch(config: ComfyConfig) {
  const data = (name: string) => join(config.dataDir, name);
  return {
    command: join(config.root, "python_embeded", "python.exe"),
    args: [
      "-s",
      "ComfyUI\\main.py",
      "--windows-standalone-build",
      "--disable-auto-launch",
      "--listen",
      config.host,
      "--port",
      String(config.port),
      "--reserve-vram",
      "1.0",
      "--output-directory",
      data("output"),
      "--input-directory",
      data("input"),
      "--temp-directory",
      data("temp"),
      "--user-directory",
      data("user"),
    ],
    cwd: config.root,
    // Torch, Triton, Hugging Face and CUDA caches default to C:; keep them next to the data.
    env: {
      TEMP: data("temp"),
      TMP: data("temp"),
      HF_HOME: data("cache\\hf"),
      TORCH_HOME: data("cache\\torch"),
      TRITON_CACHE_DIR: data("cache\\triton"),
      XDG_CACHE_HOME: data("cache"),
      PIP_CACHE_DIR: data("cache\\pip"),
      CUDA_CACHE_PATH: data("cache\\nv"),
      // The log file is not a console: without this, a non-Latin lyric line in a log can crash Python.
      PYTHONIOENCODING: "utf-8",
    },
    dirs: [
      "output",
      "input",
      "temp",
      "user",
      "cache\\hf",
      "cache\\torch",
      "cache\\triton",
      "cache\\pip",
      "cache\\nv",
    ].map(data),
  };
}

export type LocalEngineSpec = {
  // Model files under ComfyUI\models with their exact sizes from the bake-off install.
  files: { path: string; bytes: number }[];
  nodes: string[];
  // Languages that passed a bake-off; others stay hidden in the studio.
  passedLangs: Lang[];
  // Minutes of PC time per minute of audio for the whole generation (two takes, one after
  // the other): the bake-off median per take (YuE2 at the 420 s ceiling 0.755, ACE-Step SFT
  // 30 steps 0.392) times two, rounded up.
  minutesPerAudioMinute: number;
  graph: string;
  saveNode: string;
  // What the engine can do with existing audio (T12): rewrite a part of a take, cover a song.
  features: ("rewrite" | "cover")[];
};

export const LOCAL_ENGINES: Record<LocalSongEngine, LocalEngineSpec> = {
  yue2: {
    files: [
      {
        path: "checkpoints\\yue2_3b_int8_convrot.safetensors",
        bytes: 3_960_938_800,
      },
    ],
    nodes: [
      "YuE2GenerateABC",
      "YuE2GenerateMusic",
      "EmptyYuE2LatentAudio",
      "SaveAudioAdvanced",
    ],
    passedLangs: ["it"],
    minutesPerAudioMinute: 1.6,
    graph: "yue2-text2music.api.json",
    saveNode: "10",
    features: [],
  },
  "ace-step": {
    files: [
      {
        path: "diffusion_models\\acestep_v1.5_sft.safetensors",
        bytes: 4_787_825_604,
      },
      {
        path: "text_encoders\\qwen_0.6b_ace15.safetensors",
        bytes: 1_191_588_248,
      },
      {
        path: "text_encoders\\qwen_1.7b_ace15.safetensors",
        bytes: 3_708_523_360,
      },
      { path: "vae\\ace_1.5_vae.safetensors", bytes: 337_431_732 },
    ],
    nodes: [
      "TextEncodeAceStepAudio1.5",
      "EmptyAceStep1.5LatentAudio",
      "ModelSamplingAuraFlow",
      "SaveAudioAdvanced",
    ],
    passedLangs: ["it"],
    minutesPerAudioMinute: 0.8,
    graph: "ace15-sft-30steps.api.json",
    saveNode: "107",
    features: ["rewrite", "cover"],
  },
};
