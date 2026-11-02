// Child processes for yt-dlp, ffmpeg and the Python helpers. Output is captured, never
// streamed with secrets: callers pass keys only through `env`, and errors carry the
// tail of stderr after the caller's redaction.
import { spawn } from "node:child_process";

export type RunResult = { code: number; stdout: string; stderr: string };
export type Run = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<RunResult>;

export const run: Run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", ...options.env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString("utf8")).slice(-200_000);
    });
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill(), options.timeoutMs)
      : undefined;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });

export async function runChecked(
  runner: Run,
  command: string,
  args: string[],
  options: Parameters<Run>[2] & {
    what: string;
    redact?: (s: string) => string;
  } = {
    what: command,
  },
): Promise<RunResult> {
  const result = await runner(command, args, options);
  if (result.code !== 0) {
    const tail = `${result.stderr}\n${result.stdout}`
      .trim()
      .split("\n")
      .slice(-12)
      .join("\n");
    throw new Error(
      `${options.what} failed (exit ${result.code}):\n${options.redact ? options.redact(tail) : tail}`,
    );
  }
  return result;
}
