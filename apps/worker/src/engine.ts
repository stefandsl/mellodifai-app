import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import { basename } from "node:path";

type Child = {
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
  env?: Record<string, string>;
  outputs?: string[];
};

export class Engine {
  private readonly env: Record<string, string>;
  constructor(
    private readonly dependencies: {
      spawn?: Spawn;
      log: (line: string) => Promise<void>;
      env?: Record<string, string>;
    },
  ) {
    this.env = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      TMP: "E:\\mellodifai\\tmp",
      TEMP: "E:\\mellodifai\\tmp",
      ...dependencies.env,
    };
  }
  async run(
    command: string,
    args: string[],
    options: EngineOptions = {},
  ): Promise<{ code: number }> {
    const outputs = options.outputs ?? [];
    const partByOutput = new Map(
      outputs.map((output) => [output, `${output}.part`]),
    );
    const stagedArgs = args.map((arg) => partByOutput.get(arg) ?? arg);
    if (
      /^python(?:\.exe)?$/iu.test(basename(command)) &&
      stagedArgs[0] !== "-I"
    ) {
      stagedArgs.unshift("-I");
    }
    for (const part of partByOutput.values()) await rm(part, { force: true });
    const child = (this.dependencies.spawn ?? nodeSpawn)(command, stagedArgs, {
      shell: false,
      env: { ...this.env, ...options.env },
      windowsHide: true,
    });
    this.stream(child.stdout);
    this.stream(child.stderr);
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (value) => resolve(value ?? 1));
    });
    if (code === 0)
      for (const [output, part] of partByOutput) await rename(part, output);
    return { code };
  }
  withWorkspace(workspace: string): Engine {
    return new Engine({
      ...this.dependencies,
      env: { ...this.dependencies.env, ENGINE_WORKSPACE: workspace },
    });
  }
  private stream(source: NodeJS.ReadableStream | null | undefined) {
    if (!source) return;
    let remainder = "";
    source.on("data", (chunk: Buffer | string) => {
      const pieces = `${remainder}${chunk}`.split(/\r?\n/u);
      remainder = pieces.pop() ?? "";
      for (const line of pieces) if (line) void this.dependencies.log(line);
    });
    source.on("end", () => {
      if (remainder) void this.dependencies.log(remainder);
    });
  }
}
