import type { ChildProcess } from "node:child_process";
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";

/** Only these errors may cross an operator-facing boundary verbatim. */
export class NativeDiagnosticError extends Error {}

/** Arbitrary SQL/driver exceptions can contain credentials or complete queries. */
export function safeFailure(error: unknown): string {
  if (error instanceof NativeDiagnosticError) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)
    ? `operation failed (code ${code})`
    : "operation failed (no safe error code)";
}

export function redactServiceOutput(
  text: string,
  environment: Record<string, string> = {},
): string {
  const secrets = Object.entries(environment)
    .filter(([key]) =>
      /pass|secret|token|key|cookie|authorization|(?:database|db)_?(?:url|uri)/i.test(
        key,
      ),
    )
    .flatMap(([, value]) => {
      const values = [value];
      try {
        const url = new URL(value);
        values.push(url.password, decodeURIComponent(url.password));
      } catch {}
      return values
        .filter(Boolean)
        .flatMap((value) => [value, encodeURIComponent(value)]);
    })
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
  return text
    .split(/\r?\n/)
    .map((line) => {
      // A SQL statement or credential-bearing field may include a secret absent
      // from this child's environment. Omit that line rather than guessing syntax.
      if (
        /password|passwd|secret|token|authorization|api.?key|cookie|private.?key|statement:/i.test(
          line,
        )
      )
        return "[REDACTED sensitive log line]";
      return line
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "[REDACTED URL]")
        .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED JWT]")
        .replace(/[A-Za-z0-9_+/=-]{32,}/g, "[REDACTED value]");
    })
    .join("\n");
}

export function logOffset(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function tail(path: string, offset: number): string {
  try {
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      const start = Math.max(Math.min(offset, size), size - 256 * 1024);
      const buffer = Buffer.alloc(size - start);
      readSync(fd, buffer, 0, buffer.length, start);
      return (
        buffer
          .toString("utf8")
          .trimEnd()
          .split(/\r?\n/)
          .slice(-50)
          .join("\n") || "(no output)"
      );
    } finally {
      closeSync(fd);
    }
  } catch {
    return "(log unavailable)";
  }
}

/** Attach before awaiting spawn or querying the process table, so even a child
 * that dies immediately retains its exit code and this launch's output. */
export function observeService(
  child: ChildProcess,
  id: string,
  logFile: string,
  offset: number,
  environment: Record<string, string> = {},
) {
  let outcome = "still running";
  const exited = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      outcome = `exit code ${code ?? "none"}, signal ${signal ?? "none"}`;
      resolve();
    });
    child.once("error", (error) => {
      outcome = safeFailure(error);
      resolve();
    });
  });
  return {
    exited,
    failure(reason: string): NativeDiagnosticError {
      return new NativeDiagnosticError(
        `Native service ${id} ${reason} (${outcome}); see ${logFile}\nLast 50 log lines for this launch:\n${redactServiceOutput(tail(logFile, offset), environment)}`,
      );
    },
  };
}
