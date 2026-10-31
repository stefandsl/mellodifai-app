import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import { join, parse, win32 } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { childEnvironment, type Secrets } from "./secrets.js";

type Child = {
  pid?: number | undefined;
  kill?(signal?: NodeJS.Signals): boolean;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  once(event: "close", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
};
export type Spawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => Child;
export type EngineOptions = {
  onStderr?: (line: string) => void;
  allowNonZero?: boolean;
  clearOutputs?: string[];
  env?: Record<string, string>;
  outputs?: string[];
  cwd?: string;
};
type Dependencies = {
  secrets?: Secrets;
  spawn?: Spawn;
  log: (line: string) => Promise<void>;
  report?: (line: string) => void;
  env?: Record<string, string>;
  signal?: AbortSignal;
  killTree?: (child: Child) => Promise<void>;
};

async function killTree(child: Child, secrets?: Secrets): Promise<void> {
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve, reject) => {
      const killer = nodeSpawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          shell: false,
          windowsHide: true,
          env: childEnvironment(process.env, secrets),
        },
      );
      killer.once("error", reject);
      killer.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`taskkill exited ${code}`)),
      );
    });
  } else child.kill?.("SIGKILL");
}

export class Engine {
  private readonly running = new Set<Promise<unknown>>();
  constructor(private readonly dependencies: Dependencies) {}
  private report(message: string) {
    try {
      (this.dependencies.report ?? console.error)(message);
    } catch {
      /* A diagnostic sink must not reject cleanup. */
    }
  }
  async settled(): Promise<void> {
    await Promise.allSettled([...this.running]);
  }
  withWorkspace(
    workspace: string,
    log = this.dependencies.log,
    signal = this.dependencies.signal,
  ): Engine {
    return new Engine({
      ...this.dependencies,
      log,
      ...(signal ? { signal } : {}),
      env: { ...this.dependencies.env, ENGINE_WORKSPACE: workspace },
    });
  }
  async run(
    command: string,
    args: string[],
    options: EngineOptions = {},
  ): Promise<{ code: number }> {
    const execution = this.execute(command, args, options);
    this.running.add(execution);
    try {
      return await execution;
    } finally {
      this.running.delete(execution);
    }
  }
  private async execute(
    command: string,
    args: string[],
    options: EngineOptions,
  ): Promise<{ code: number }> {
    const { signal } = this.dependencies;
    signal?.throwIfAborted();
    // .cmd shims require a shell. Reject them (and npx) explicitly; callers use node with the CLI JS path.
    if (
      /\.(cmd|bat)$/iu.test(command) ||
      /^npx(?:\.exe)?$/iu.test(win32.basename(command))
    ) {
      throw new Error(
        "Shell shims are unsupported: use node <path to remotion CLI js> instead of npx or .cmd",
      );
    }
    const parts = new Map(
      (options.outputs ?? []).map((file) => {
        const { dir, name, ext } = parse(file);
        return [file, join(dir, `${name}.part${ext}`)];
      }),
    );
    const staged = args.map((arg) => parts.get(arg) ?? arg);
    if (/^(python|py)(?:\.exe)?$/iu.test(win32.basename(command))) {
      if (staged[0] === "-I") staged.shift();
      if (staged[0] === "-X" && staged[1] === "utf8") staged.splice(0, 2);
      staged.unshift("-I", "-X", "utf8");
    }
    for (const file of [
      ...parts.keys(),
      ...parts.values(),
      ...(options.clearOutputs ?? []),
    ])
      await rm(file, { force: true });
    signal?.throwIfAborted();
    const child = (this.dependencies.spawn ?? nodeSpawn)(command, staged, {
      shell: false,
      windowsHide: true,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: {
        ...childEnvironment(
          {
            ...process.env,
            ...this.dependencies.env,
            ...options.env,
          },
          this.dependencies.secrets,
        ),
        PYTHONIOENCODING: "utf-8",
        TMP: "E:\\mellodifai\\tmp",
        TEMP: "E:\\mellodifai\\tmp",
      },
    });
    let logs = Promise.resolve();
    const tail: string[] = [];
    let logError: unknown;
    const emit = (line: string) => {
      line = this.dependencies.secrets?.redact(line) ?? line;
      tail.push(line);
      if (tail.length > 20) tail.shift();
      logs = logs
        .then(() => this.dependencies.log(line))
        .catch((error: unknown) => {
          logError = error;
          this.report("Engine log delivery failed");
        });
    };
    const flushes = [child.stdout, child.stderr].map((source) => {
      const decoder = new StringDecoder("utf8");
      let remainder = "";
      const deliver = (line: string) => {
        if (source === child.stderr)
          options.onStderr?.(this.dependencies.secrets?.redact(line) ?? line);
        emit(line);
      };
      const consume = (text: string) => {
        const lines = `${remainder}${text}`.split(/\r\n|\n|\r/u);
        remainder = lines.pop() ?? "";
        for (const line of lines) if (line) deliver(line);
      };
      source?.on("data", (chunk: Buffer | string) =>
        consume(typeof chunk === "string" ? chunk : decoder.write(chunk)),
      );
      return () => {
        consume(decoder.end());
        if (remainder) deliver(remainder);
        remainder = "";
      };
    });
    let kill: Promise<void> | undefined;
    const closed = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    let abortReject: (error: Error) => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      abortReject = reject;
    });
    const abort = () => {
      kill = Promise.resolve()
        .then(() =>
          this.dependencies.killTree
            ? this.dependencies.killTree(child)
            : killTree(child, this.dependencies.secrets),
        )
        .catch(() => {
          this.report("Child process tree termination failed");
        });
      void kill
        .then(() => abortReject(new Error("Engine execution aborted")))
        .catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const code = await Promise.race([closed, aborted]);
      for (const flush of flushes) flush();
      await logs;
      signal?.throwIfAborted();
      if (logError) throw new Error("Engine log delivery failed");
      if (code !== 0 && !options.allowNonZero)
        throw new Error(`${command} exited ${code}\n${tail.join("\n")}`);
      if (code === 0)
        for (const [file, part] of parts) await rename(part, file);
      return { code };
    } finally {
      signal?.removeEventListener("abort", abort);
      await kill;
      for (const flush of flushes) flush();
      await logs;
    }
  }
}
