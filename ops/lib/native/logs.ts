import {
  chmodSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  renameSync,
  statfsSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { realRunner } from "../run.js";
import { NativeDiagnosticError, serviceRedactor } from "./diagnostics.js";

/** A live log file grows to this size before it is rotated. */
export const LOG_MAX_BYTES = 10 * 1024 * 1024;
/** Rotated files kept per log beside the live one (name.1 is the newest). */
export const LOG_KEEP = 5;
/** A line longer than this is written in pieces, each redacted on its own. */
const MAX_LINE_BYTES = 64 * 1024;

export interface LogOptions {
  maxBytes?: number;
  keep?: number;
  /** Applied to every line before it reaches the disk. */
  redact?: (line: string) => string;
}

const secured = new Set<string>();

/**
 * Make a log folder readable by its owner only, like the secret files: files
 * created inside inherit that ACL. Idempotent; done once per process.
 */
export async function securePrivateDirectory(directory: string): Promise<void> {
  mkdirSync(directory, { recursive: true });
  if (secured.has(directory)) return;
  if (process.platform === "win32") {
    const user = process.env.USERNAME;
    if (!user) throw new Error("USERNAME is required for private log ACLs");
    const result = await realRunner("icacls", [
      directory,
      "/inheritance:r",
      "/grant:r",
      `${user}:(OI)(CI)F`,
    ]);
    if (result.code !== 0) throw new Error("Cannot secure the log folder ACL");
  } else chmodSync(directory, 0o700);
  secured.add(directory);
}

/**
 * An append-only log with a size bound: every complete line is redacted and
 * written; past `maxBytes` the file becomes name.1, older ones shift, and the
 * oldest beyond `keep` is removed. Writes are synchronous, so a crash loses
 * at most a partial line.
 */
export class RotatingLog {
  private fd: number;
  private size: number;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly redact: (line: string) => string;

  constructor(
    readonly file: string,
    options: LogOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
    this.keep = options.keep ?? LOG_KEEP;
    this.redact = options.redact ?? ((line) => line);
    mkdirSync(dirname(file), { recursive: true });
    this.fd = openSync(file, "a", 0o600);
    this.size = fstatSync(this.fd).size;
  }

  /** Lines lost to a failed write or to the hard bound, since this log opened. */
  dropped = 0;
  /** Lost lines not yet reported in the file itself. */
  private unreported = 0;
  private lastError = "";

  /**
   * Write one complete line (without its line break). Never throws: it runs
   * inside child stream handlers, where an exception would end the
   * supervisor. A line that cannot be written is counted and reported in the
   * file as soon as writing works again.
   */
  line(text: string): void {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(`${this.redact(text)}\n`, "utf8");
    } catch {
      this.drop("redaction");
      return;
    }
    if (this.size > 0 && this.size + bytes.length > this.maxBytes)
      this.rotate();
    // Rotation kept failing: past twice the bound, drop rather than grow.
    if (this.size > 0 && this.size + bytes.length > 2 * this.maxBytes) {
      this.drop("rotation blocked");
      return;
    }
    if (this.unreported > 0) {
      const notice = Buffer.from(
        `${new Date().toISOString()} ${this.unreported} log line(s) dropped (${this.lastError})\n`,
        "utf8",
      );
      if (!this.write(notice)) {
        this.drop(this.lastError);
        return;
      }
      this.unreported = 0;
    }
    if (!this.write(bytes)) this.drop(this.lastError);
  }

  private write(bytes: Buffer): boolean {
    try {
      writeSync(this.fd, bytes);
      this.size += bytes.length;
      return true;
    } catch (error) {
      this.lastError = (error as NodeJS.ErrnoException).code ?? "write error";
      return false;
    }
  }

  private drop(reason: string): void {
    this.dropped++;
    this.unreported++;
    this.lastError = reason;
  }

  /** A line splitter for one output stream of a child. */
  stream(): { write(chunk: Buffer | string): void; end(): void } {
    let pending = "";
    const decoder = new StringDecoder("utf8");
    return {
      write: (chunk) => {
        pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
        let index = pending.search(/\r?\n/);
        while (index !== -1) {
          this.line(pending.slice(0, index));
          pending = pending.slice(index + (pending[index] === "\r" ? 2 : 1));
          index = pending.search(/\r?\n/);
        }
        while (Buffer.byteLength(pending) > MAX_LINE_BYTES) {
          this.line(pending.slice(0, MAX_LINE_BYTES));
          pending = pending.slice(MAX_LINE_BYTES);
        }
      },
      end: () => {
        pending += decoder.end();
        if (pending) this.line(pending);
        pending = "";
      },
    };
  }

  /** Follow a child's stdout or stderr until it ends. */
  follow(source: Readable | null): void {
    if (!source) return;
    const lines = this.stream();
    source.on("data", (chunk: Buffer) => lines.write(chunk));
    source.on("end", () => lines.end());
    source.on("error", () => lines.end());
  }

  /**
   * Shift the rotated files and start a new live file. Any failure (a reader
   * locking a file on Windows, a full disk) keeps the current handle and the
   * live file's content: the next line tries again, and `line` drops lines
   * past twice the bound instead of truncating anything.
   */
  private rotate(): void {
    try {
      // Each rename replaces its target, so the oldest file drops out.
      for (let index = this.keep - 1; index >= 1; index--) {
        try {
          renameSync(`${this.file}.${index}`, `${this.file}.${index + 1}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      // Node opens files with delete sharing, so the open handle does not
      // block this rename; it follows the file to name.1.
      renameSync(this.file, `${this.file}.1`);
    } catch (error) {
      this.lastError = (error as NodeJS.ErrnoException).code ?? "rotate error";
      return;
    }
    let next: number;
    try {
      next = openSync(this.file, "a", 0o600);
    } catch (error) {
      // The handle still writes to name.1: keep it until a new file opens.
      this.lastError = (error as NodeJS.ErrnoException).code ?? "open error";
      return;
    }
    try {
      closeSync(this.fd);
    } catch {
      /* The old handle is no longer used either way. */
    }
    this.fd = next;
    this.size = 0;
  }

  close(): void {
    try {
      closeSync(this.fd);
    } catch {
      /* Nothing more can be written either way. */
    }
  }
}

/** A rotating, redacting log for a child whose environment holds secrets. */
export function serviceLog(
  file: string,
  environment: Record<string, string> = {},
  options: Omit<LogOptions, "redact"> = {},
): RotatingLog {
  return new RotatingLog(file, {
    ...options,
    redact: serviceRedactor(environment),
  });
}

/** Free space the data volume must keep; below it the stack refuses to start. */
export const DATA_RESERVE_BYTES = 5 * 1024 ** 3;

export function dataReserveBytes(
  value = process.env.MDF_NATIVE_DATA_RESERVE_BYTES,
): number {
  if (value === undefined || value === "") return DATA_RESERVE_BYTES;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("MDF_NATIVE_DATA_RESERVE_BYTES must be a whole number");
  return Number(value);
}

export type FreeSpace = (path: string) => number;

export const freeSpace: FreeSpace = (path) => {
  const stats = statfsSync(path);
  return stats.bavail * stats.bsize;
};

/** Refuse to start a stack whose data volume is below its reserve. */
export function assertDataDiskFree(
  root: string,
  reserve = dataReserveBytes(),
  free: FreeSpace = freeSpace,
): void {
  const available = free(root);
  if (available < reserve)
    throw new NativeDiagnosticError(
      `Native stack refused: the data volume of ${root} has ${Math.floor(available / 1024 ** 2)} MB free, below the ${Math.floor(reserve / 1024 ** 2)} MB reserve`,
    );
}

/**
 * While the stack runs: one warning when free space drops below the reserve,
 * and another only after it has recovered and dropped again.
 */
export function watchDataDisk(
  root: string,
  warn: (message: string) => void,
  options: { reserve?: number; free?: FreeSpace; intervalMs?: number } = {},
): () => void {
  const reserve = options.reserve ?? dataReserveBytes();
  const free = options.free ?? freeSpace;
  let below = false;
  const check = () => {
    let available: number;
    try {
      available = free(root);
    } catch {
      return;
    }
    if (available < reserve && !below)
      warn(
        `warning: the data volume of ${root} has ${Math.floor(available / 1024 ** 2)} MB free, below the ${Math.floor(reserve / 1024 ** 2)} MB reserve`,
      );
    below = available < reserve;
  };
  check();
  const timer = setInterval(check, options.intervalMs ?? 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
