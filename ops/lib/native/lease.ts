import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StackEnv } from "../envs.js";
import { NativeDiagnosticError } from "./diagnostics.js";
import { pidAlive } from "./host.js";
import { nativeLayout } from "./layout.js";

type Ownership = { active: boolean };
const key = Symbol.for("mellodifai.native.stackLeaseContext");
const global = globalThis as typeof globalThis & {
  [key]?: AsyncLocalStorage<Map<string, Ownership>>;
};
// A deploy may load a reviewed release's modules in the same process. Share
// only the in-process context, never an environment-variable lock bypass.
if (!global[key]) global[key] = new AsyncLocalStorage<Map<string, Ownership>>();
const context = global[key];
const helper = fileURLToPath(
  new URL("../../native/lease.ps1", import.meta.url),
);
export const leasePath = (env: StackEnv) =>
  resolve(join(nativeLayout(env).root, "stack.lease"));

/** A short command has nothing to stop: losing its lease ends it at once. */
const exitOnLoss = () => {
  process.stderr.write(
    "Exclusive stack lease helper died; terminating the operation\n",
  );
  process.exit(1);
};

/** The time one PowerShell process gets to start and answer. */
const POWERSHELL_MS = 15_000;

/** For the error text only. A lease whose last holder is gone is released as
 * soon as its helper ends. When it stays locked, say whether that helper still
 * runs. If it does not, a process that is not a lease helper has the file.
 * The process query gets POWERSHELL_MS (3.2 s to 6.3 s in 120 runs on a PC at
 * 100% CPU). Without an answer in that time the error has the short text. */
function orphanedLease(path: string, owner: number): Promise<string> {
  const gone = ` (process ${owner} is no longer running`;
  return new Promise((resolve) => {
    const unknown = () => resolve(`${gone})`);
    let query: ReturnType<typeof spawn>;
    try {
      query = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:MDF_LEASE_PATH) -and $_.CommandLine.Contains('-OwnerPid ' + $env:MDF_LEASE_OWNER + ' ') } | ForEach-Object { $_.ProcessId }",
        ],
        {
          env: {
            ...process.env,
            MDF_LEASE_PATH: path,
            MDF_LEASE_OWNER: String(owner),
          },
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    } catch {
      return unknown();
    }
    let output = "";
    query.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const timer = setTimeout(() => {
      query.kill();
      unknown();
    }, POWERSHELL_MS);
    query.once("error", () => {
      clearTimeout(timer);
      unknown();
    });
    query.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return unknown();
      const helpers = output.split(/\s+/).filter(Boolean);
      resolve(
        helpers.length
          ? `${gone}; its lease helper, pid ${helpers.join(", ")}, is still running)`
          : `${gone} and none of its lease helpers is running)`,
      );
    });
  });
}

/**
 * Hold an OS-backed exclusive lease while the returned release is pending.
 * `onLost` runs once if the helper dies while the lease is held. The
 * supervisor passes one that stops its children cleanly before it exits.
 * A refusal comes at most `timeoutMs` plus POWERSHELL_MS after the call, and
 * at most POWERSHELL_MS later when the recorded holder is gone.
 */
export async function acquireLease(
  path: string,
  command: string,
  timeoutMs = 5000,
  onLost: () => void = exitOnLoss,
): Promise<() => Promise<void>> {
  if (process.platform !== "win32")
    throw new Error("Native stack leases require Windows");
  if (!/^[a-z][a-z0-9-]*$/.test(command))
    throw new Error("Invalid lease command name");
  mkdirSync(dirname(path), { recursive: true });
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helper,
      "-Path",
      path,
      "-Command",
      command,
      "-OwnerPid",
      String(process.pid),
      "-TimeoutMs",
      String(timeoutMs),
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
  );
  const exited = new Promise<void>((done) => child.once("close", () => done()));
  child.stdin.on("error", () => {});
  let active = false;
  let refused = false;
  let releasing = false;
  child.once("exit", () => {
    if (active && !releasing) onLost();
  });
  try {
    await new Promise<void>((done, fail) => {
      let output = "";
      const timer = setTimeout(
        () => fail(new Error("Stack lease helper timed out")),
        timeoutMs + POWERSHELL_MS,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        fail(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        if (!active && !refused)
          fail(new Error("Stack lease helper exited before acquisition"));
      });
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (!output.includes("\n")) return;
        clearTimeout(timer);
        if (output.trim() === "acquired") {
          active = true;
          done();
        } else {
          refused = true;
          let holder = "unknown operation";
          let orphan = Promise.resolve("");
          try {
            const value = JSON.parse(
              readFileSync(`${path}.holder.json`, "utf8"),
            );
            if (
              /^[a-z][a-z0-9-]*$/.test(value.command) &&
              Number.isSafeInteger(value.pid)
            ) {
              holder = `${value.command} (pid ${value.pid})`;
              if (!pidAlive(value.pid)) orphan = orphanedLease(path, value.pid);
            }
          } catch {
            /* Informational metadata may be absent, never guess ownership. */
          }
          void orphan.then((detail) =>
            fail(
              new NativeDiagnosticError(
                `Stack lease held by ${holder}; timed out after ${timeoutMs}ms${detail}`,
              ),
            ),
          );
        }
      });
    });
  } catch (error) {
    child.stdin.end();
    child.kill();
    await exited;
    throw error;
  }
  return async () => {
    releasing = true;
    child.stdin.end("release\n");
    await exited;
  };
}

export function assertStackLease(env: StackEnv): void {
  if (!context.getStore()?.get(leasePath(env))?.active)
    throw new Error("Stack mutation requires the exclusive stack lease");
}
export async function withStackLease<T>(
  env: StackEnv,
  command: string,
  operation: () => Promise<T>,
): Promise<T> {
  const path = leasePath(env);
  if (context.getStore()?.get(path)?.active) return operation();
  const release = await acquireLease(path, command);
  const owner = { active: true };
  const scope = new Map(context.getStore());
  scope.set(path, owner);
  try {
    return await context.run(scope, operation);
  } finally {
    owner.active = false;
    await release();
  }
}
