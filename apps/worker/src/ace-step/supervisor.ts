import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  ACE_STEP_TEXT,
  type LocalEngineStatus,
  type LocalEngineStep,
} from "@mellodifai/shared";
import { HOST_SCRIPT } from "./host-script.js";

// Errors whose message is already a plain Italian sentence for the end user.
export class AceStepError extends Error {
  constructor(
    message: string,
    readonly detail = "",
  ) {
    super(message);
  }
}

export type AceStepConfig = {
  root: string;
  repo: string;
  tag: string;
  port: number;
  python: string;
  uv: string;
  git: string;
  models: { repo: string; dir: string; ignore?: string[] }[];
  expectedModelBytes: number;
  minFreeDiskBytes: number;
  healthTimeoutMs: number;
  idleStopMs: number;
  ditModel: string;
  lmModel: string;
};

// Pinned to a release tag of the official repository; models from the official
// HuggingFace organisation. The 1.7B language model is skipped: 8 GB cards use 0.6B.
export const DEFAULT_ACE_STEP_CONFIG: AceStepConfig = {
  root: "E:\\mellodifai\\ace-step",
  repo: "https://github.com/ace-step/ACE-Step-1.5.git",
  tag: "v0.1.8",
  port: 18001,
  python: "3.12",
  uv: "uv",
  git: "git",
  models: [
    {
      repo: "ACE-Step/Ace-Step1.5",
      dir: "",
      ignore: ["acestep-5Hz-lm-1.7B/*"],
    },
    { repo: "ACE-Step/acestep-5Hz-lm-0.6B", dir: "acestep-5Hz-lm-0.6B" },
  ],
  expectedModelBytes: 7_700_000_000,
  minFreeDiskBytes: 25_000_000_000,
  healthTimeoutMs: 600_000,
  idleStopMs: 0,
  ditModel: "acestep-v15-turbo",
  lmModel: "acestep-5Hz-lm-0.6B",
};

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string>;
};
export type ServerProcess = {
  pid?: number | undefined;
  exited: Promise<unknown>;
};
export type AceStepDeps = {
  // Runs a setup command to completion; rejects on a non-zero exit.
  run(command: string, args: string[], options: RunOptions): Promise<void>;
  spawnServer(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; logFile: string },
  ): ServerProcess;
  killPid(pid: number): Promise<void>;
  fetch: typeof fetch;
  publish(status: LocalEngineStatus): Promise<void>;
  freeDiskBytes(path: string): Promise<number | null>;
  freeVramMb?(): Promise<number | null>;
  sleep?(ms: number): Promise<void>;
  report?(line: string): void;
};

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function dirSize(path: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile())
      total += (await stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

function classify(error: unknown, fallback: string): AceStepError {
  if (error instanceof AceStepError) return error;
  const text = error instanceof Error ? error.message : String(error);
  if (/ENOSPC|No space left|not enough space|spazio/iu.test(text))
    return new AceStepError(ACE_STEP_TEXT.errorNoSpace, text);
  if (
    /ENOTFOUND|ECONNRESET|ETIMEDOUT|getaddrinfo|Could not resolve|connection|HTTP Error|ReadTimeout/iu.test(
      text,
    )
  )
    return new AceStepError(ACE_STEP_TEXT.errorNetwork, text);
  return new AceStepError(fallback, text);
}

/**
 * Owns the ACE-Step installation and its API server on this PC. One instance per
 * worker process: it installs on first use (idempotent, resumable, one step marker
 * per stage), starts the server on 127.0.0.1 when a song needs it and stops it as
 * soon as no song is using it, so Remotion and Demucs get the GPU back.
 */
export class AceStepSupervisor {
  private provisioning: Promise<void> | undefined;
  private starting: Promise<void> | undefined;
  private server: ServerProcess | undefined;
  private users = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private status: LocalEngineStatus = { state: "not_installed" };
  private lastPublish = 0;
  readonly apiKey = randomBytes(24).toString("hex");
  constructor(
    private readonly deps: AceStepDeps,
    readonly config: AceStepConfig = DEFAULT_ACE_STEP_CONFIG,
  ) {}

  get baseUrl() {
    return `http://127.0.0.1:${this.config.port}`;
  }
  private path(...parts: string[]) {
    return join(this.config.root, ...parts);
  }
  private marker(name: string) {
    return this.path("state", `${name}.done`);
  }
  private get venvPython() {
    return this.path("venv", "Scripts", "python.exe");
  }
  private get steps(): { name: string; step: LocalEngineStep }[] {
    return [
      { name: `code-${this.config.tag}`, step: "download_code" },
      { name: `install-${this.config.tag}`, step: "install" },
      { name: "models-v1", step: "download_models" },
    ];
  }
  private sleep(ms: number) {
    return this.deps.sleep ? this.deps.sleep(ms) : delay(ms);
  }
  private report(line: string) {
    try {
      (this.deps.report ?? console.error)(line);
    } catch {
      /* diagnostics only */
    }
  }
  private async publish(status: LocalEngineStatus, force = true) {
    this.status = status;
    const now = Date.now();
    if (!force && now - this.lastPublish < 2000) return;
    this.lastPublish = now;
    try {
      await this.deps.publish({
        ...status,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      this.report("ACE-Step status publish failed");
    }
  }
  isRunning(): boolean {
    return Boolean(this.server);
  }
  async freeVramMb(): Promise<number | null> {
    return (await this.deps.freeVramMb?.().catch(() => null)) ?? null;
  }
  get fetch(): typeof fetch {
    return this.deps.fetch;
  }
  currentStatus(): LocalEngineStatus {
    return this.status;
  }
  async installed(): Promise<boolean> {
    for (const { name } of this.steps)
      if (!(await exists(this.marker(name)))) return false;
    return true;
  }
  // Called once at worker start: tells the web app whether setup is needed.
  async announce(): Promise<void> {
    await this.publish(
      (await this.installed())
        ? { state: "ready" }
        : { state: "not_installed" },
    );
  }

  private env(): Record<string, string> {
    return {
      UV_CACHE_DIR: this.path("uv-cache"),
      UV_PYTHON_INSTALL_DIR: this.path("python"),
      UV_PROJECT_ENVIRONMENT: this.path("venv"),
      UV_LINK_MODE: "copy",
      HF_HOME: this.path("hf-home"),
      HF_HUB_DISABLE_TELEMETRY: "1",
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      PIP_CACHE_DIR: this.path("pip-cache"),
      TMP: this.path("tmp"),
      TEMP: this.path("tmp"),
    };
  }

  ensureInstalled(): Promise<void> {
    this.provisioning ??= this.install().finally(() => {
      this.provisioning = undefined;
    });
    return this.provisioning;
  }
  private async install(): Promise<void> {
    if (await this.installed()) return;
    for (const dir of ["state", "tmp", "logs", "checkpoints"])
      await mkdir(this.path(dir), { recursive: true });
    const free = await this.deps
      .freeDiskBytes(this.config.root)
      .catch(() => null);
    if (free !== null && free < this.config.minFreeDiskBytes) {
      const error = new AceStepError(ACE_STEP_TEXT.errorNoSpace);
      await this.publish({ state: "error", message: error.message });
      throw error;
    }
    for (const { name, step } of this.steps) {
      if (await exists(this.marker(name))) continue;
      await this.publish({ state: "installing", step, pct: 0 });
      try {
        if (step === "download_code") await this.downloadCode();
        else if (step === "install") await this.installPackages();
        else await this.downloadModels();
      } catch (error) {
        const failure = classify(error, ACE_STEP_TEXT.errorInstall);
        this.report(
          `ACE-Step ${step} failed: ${failure.detail || failure.message}`,
        );
        await this.publish({ state: "error", step, message: failure.message });
        throw failure;
      }
      await writeFile(this.marker(name), new Date().toISOString());
    }
    await this.publish({ state: "ready" });
  }
  private async downloadCode() {
    const src = this.path("src");
    // A half-finished clone is not resumable by git; start that one step over.
    await rm(src, { recursive: true, force: true });
    await this.deps.run(
      this.config.git,
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        this.config.tag,
        this.config.repo,
        src,
      ],
      { cwd: this.config.root, env: this.env() },
    );
  }
  private async installPackages() {
    // uv keeps downloaded wheels in its cache on E:, so a retry resumes.
    await this.deps.run(
      this.config.uv,
      ["sync", "--python", this.config.python, "--no-dev"],
      { cwd: this.path("src"), env: this.env() },
    );
  }
  private async downloadModels() {
    const checkpoints = this.path("checkpoints");
    let done = false;
    const watcher = (async () => {
      while (!done) {
        await this.sleep(5000);
        if (done) break;
        const pct = Math.min(
          99,
          (100 * (await dirSize(checkpoints))) / this.config.expectedModelBytes,
        );
        await this.publish(
          { state: "installing", step: "download_models", pct },
          false,
        );
      }
    })();
    try {
      for (const model of this.config.models) {
        // snapshot_download resumes partial files and skips finished ones.
        await this.deps.run(
          this.venvPython,
          [
            "-c",
            "import sys,json;from huggingface_hub import snapshot_download as d;d(sys.argv[1],local_dir=sys.argv[2],ignore_patterns=json.loads(sys.argv[3]) or None)",
            model.repo,
            join(checkpoints, model.dir),
            JSON.stringify(model.ignore ?? []),
          ],
          { cwd: this.path("src"), env: this.env() },
        );
      }
    } finally {
      done = true;
      await watcher.catch(() => {});
    }
  }

  private async healthy(): Promise<boolean> {
    try {
      const response = await this.deps.fetch(`${this.baseUrl}/health`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { data?: { status?: string } };
      return body.data?.status === "ok";
    } catch {
      return false;
    }
  }
  // Begins one use of the server; pair every call with release().
  async acquire(): Promise<void> {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.users += 1;
    try {
      await this.ensureInstalled();
      this.starting ??= this.start().finally(() => {
        this.starting = undefined;
      });
      await this.starting;
    } catch (error) {
      await this.release();
      throw error;
    }
  }
  async release(): Promise<void> {
    this.users = Math.max(0, this.users - 1);
    if (this.users > 0) return;
    if (this.config.idleStopMs <= 0) await this.stop();
    else
      this.idleTimer = setTimeout(() => {
        if (this.users === 0) void this.stop();
      }, this.config.idleStopMs);
  }
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
  private async killStale() {
    const pidFile = this.path("state", "server.pid");
    try {
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      if (Number.isInteger(pid) && pid > 0)
        await this.deps.killPid(pid).catch(() => {});
    } catch {
      /* no stale server */
    }
    await rm(pidFile, { force: true });
  }
  private async start(): Promise<void> {
    if (this.server && (await this.healthy())) return;
    await this.publish({ state: "running", step: "starting" });
    // A server left by a crashed worker has an unknown key: replace it.
    await this.killStale();
    await mkdir(this.path("launcher"), { recursive: true });
    const host = this.path("launcher", "acestep_host.py");
    await writeFile(host, HOST_SCRIPT);
    const server = this.deps.spawnServer(
      this.venvPython,
      ["-I", "-X", "utf8", host, "--parent-pid", String(process.pid)],
      {
        cwd: this.path("src"),
        logFile: this.path("logs", "server.log"),
        env: {
          ...this.env(),
          ACESTEP_API_HOST: "127.0.0.1",
          ACESTEP_API_PORT: String(this.config.port),
          ACESTEP_API_KEY: this.apiKey,
          ACESTEP_CHECKPOINTS_DIR: this.path("checkpoints"),
          ACESTEP_CONFIG_PATH: this.config.ditModel,
          ACESTEP_LM_MODEL_PATH: this.config.lmModel,
          ACESTEP_LM_BACKEND: "pt",
          ACESTEP_INIT_LLM: "true",
          ACESTEP_OFFLOAD_TO_CPU: "true",
          PYTHONIOENCODING: "utf-8",
        },
      },
    );
    this.server = server;
    if (server.pid)
      await writeFile(this.path("state", "server.pid"), String(server.pid));
    let exited = false;
    void server.exited.then(() => {
      exited = true;
      if (this.server === server) this.server = undefined;
    });
    const deadline = Date.now() + this.config.healthTimeoutMs;
    while (Date.now() < deadline) {
      if (exited) break;
      if (await this.healthy()) {
        await this.publish({ state: "running", step: "generating" });
        return;
      }
      await this.sleep(2000);
    }
    await this.stop();
    const error = new AceStepError(ACE_STEP_TEXT.errorStart);
    await this.publish({ state: "error", message: error.message });
    throw error;
  }
  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server?.pid) await this.deps.killPid(server.pid).catch(() => {});
    await rm(this.path("state", "server.pid"), { force: true }).catch(() => {});
    if (this.status.state === "running")
      await this.publish({
        state: (await this.installed()) ? "ready" : "not_installed",
      });
  }
  // Worker shutdown: never leave the GPU held by an orphan server.
  async shutdown(): Promise<void> {
    clearTimeout(this.idleTimer);
    await this.stop();
  }
}

export function killPidTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const killer =
      process.platform === "win32"
        ? nodeSpawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
            shell: false,
            windowsHide: true,
          })
        : nodeSpawn("kill", ["-9", String(pid)], { shell: false });
    killer.once("error", reject);
    killer.once("close", () => resolve());
  });
}
