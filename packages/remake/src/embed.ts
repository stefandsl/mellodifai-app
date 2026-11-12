// Local LaBSE embeddings (design 10.3) through a long-lived Python process, with a
// per-text cache so repeated originality checks only embed new lines.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeRoot } from "./paths.js";

export const LABSE_PYTHON = `${runtimeRoot()}/venvs/labse/Scripts/python.exe`;
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "python",
  "embed.py",
);

export class LabseEmbedder {
  readonly name = "LaBSE (sentence-transformers/LaBSE, local CPU)";
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private buffer = "";
  private waiting: {
    resolve: (line: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, number[]>();

  constructor(
    private readonly python = process.env.REMAKE_LABSE_PYTHON ?? LABSE_PYTHON,
  ) {}

  static available(
    python = process.env.REMAKE_LABSE_PYTHON ?? LABSE_PYTHON,
  ): boolean {
    return existsSync(python);
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const root = runtimeRoot();
    const child = spawn(this.python, ["-I", SCRIPT], {
      env: {
        ...process.env,
        HF_HOME: process.env.HF_HOME ?? `${root}/cache/hf`,
        TMP: `${root}/cache`,
        TEMP: `${root}/cache`,
        PYTHONIOENCODING: "utf-8",
        TOKENIZERS_PARALLELISM: "false",
      },
      windowsHide: true,
    });
    this.child = child;
    child.stdout.on("data", (d: Buffer) => {
      if (this.child !== child) return;
      this.buffer += d.toString("utf8");
      let nl = this.buffer.indexOf("\n");
      while (nl >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        this.waiting.shift()?.resolve(line);
        nl = this.buffer.indexOf("\n");
      }
    });
    this.ready = new Promise((resolve, reject) => {
      let err = "";
      const fail = (error: Error) => {
        if (this.child === child) {
          this.child = null;
          this.ready = null;
          this.buffer = "";
          for (const waiter of this.waiting.splice(0)) waiter.reject(error);
        }
        reject(error);
      };
      const onData = (d: Buffer) => {
        err = (err + d.toString("utf8")).slice(-4000);
        if (/^ready$/mu.test(err)) {
          child.stderr.off("data", onData);
          resolve();
        }
      };
      child.stderr.on("data", onData);
      child.on("error", fail);
      child.on("exit", (code) =>
        fail(new Error(`LaBSE embedder exited (${code}): ${err.slice(-600)}`)),
      );
    });
    return this.ready;
  }

  embed = async (texts: string[]): Promise<number[][]> => {
    const missing = [...new Set(texts.filter((t) => !this.cache.has(t)))];
    if (missing.length > 0) {
      const job = this.queue.then(async () => {
        await this.start();
        const child = this.child;
        if (!child) throw new Error("LaBSE embedder stopped");
        const answer = new Promise<string>((resolve, reject) =>
          this.waiting.push({ resolve, reject }),
        );
        child.stdin.write(`${JSON.stringify({ texts: missing })}\n`);
        const reply = JSON.parse(await answer) as {
          vectors?: number[][];
          error?: string;
        };
        if (!reply.vectors || reply.vectors.length !== missing.length)
          throw new Error(
            `LaBSE embedding failed: ${reply.error ?? "count mismatch"}`,
          );
        for (const [i, t] of missing.entries())
          this.cache.set(t, reply.vectors?.[i] ?? []);
      });
      this.queue = job.catch(() => {});
      await job;
    }
    return texts.map((t) => this.cache.get(t) ?? []);
  };

  close(): void {
    for (const waiter of this.waiting.splice(0))
      waiter.reject(new Error("LaBSE embedder closed"));
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
  }
}
