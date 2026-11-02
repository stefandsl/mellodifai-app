import { spawn } from "node:child_process";

type Reply = { code: number; stdout: string; stderr: string };
export type Runner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string>; input?: string },
) => Promise<Reply>;

export const realRunner: Runner = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(opts.input);
  });

export function recordingRunner(
  replies: Reply[] = [],
): Runner & { calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const runner: Runner = async (cmd, args) => {
    const index = calls.length;
    calls.push({ cmd, args: [...args] });
    return replies[index] ?? { code: 0, stdout: "", stderr: "" };
  };
  return Object.assign(runner, { calls });
}
