import type { Connect } from "./client.js";
import type { ComfySupervisor } from "./supervisor.js";

// Design 5.2 and 5.3: watchdog, progress throttle and the free-VRAM gate.
export type LocalLimits = {
  // No WebSocket event for the running prompt for this long: it hangs (ComfyUI #16416).
  stallMs: number;
  takeMs: number;
  pollMs: number;
  progressMs: number;
  minFreeVramMb: number;
  retryLaterMs: number;
};
export const LOCAL_LIMITS: LocalLimits = {
  stallMs: 120_000,
  takeMs: 15 * 60_000,
  pollMs: 2_000,
  progressMs: 2_000,
  minFreeVramMb: 6_144,
  retryLaterMs: 5 * 60_000,
};

// What a local generate_song needs from the worker process.
export type LocalRuntime = {
  supervisor: Pick<
    ComfySupervisor,
    "baseUrl" | "ensureStarted" | "stop" | "restart" | "isUp"
  >;
  // ComfyUI's --output-directory, where a finished take can be found again after a crash.
  outputDir: string;
  // ComfyUI's --input-directory, where LoadAudio reads a source the worker copies in.
  inputDir?: string;
  freeVramMb(): Promise<number | null>;
  fetch?: typeof fetch;
  connect?: Connect;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  limits?: Partial<LocalLimits>;
};
