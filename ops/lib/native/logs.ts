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
import { secureWindowsOwnerOnly } from "../private-file.js";
import {
  NativeDiagnosticError,
  SENSITIVE_LINE_MARK,
  sensitiveLogLine,
  serviceRedactor,
  TOKEN_CHARACTER,
} from "./diagnostics.js";

/** A live log file grows to this size before it is rotated. */
export const LOG_MAX_BYTES = 10 * 1024 * 1024;
/** Rotated files kept per log beside the live one (name.1 is the newest). */
export const LOG_KEEP = 5;
/** A line longer than this is written in pieces, each redacted on its own. */
export const MAX_LINE_BYTES = 64 * 1024;
/** Bytes around a cut that both neighbouring pieces are checked with. */
export const SPLIT_OVERLAP = 4 * 1024;

export interface LogOptions {
  maxBytes?: number;
  keep?: number;
  /** Applied to every line before it reaches the disk. */
  redact?: (line: string) => string;
  /** A line piece for which this is true is omitted, with the rest of its line. */
  sensitive?: (text: string) => boolean;
}

/**
 * Cut a long line after at most MAX_LINE_BYTES on a UTF-8 boundary. The cut
 * moves back to just after the last space within SPLIT_OVERLAP bytes, else
 * after the last character no token contains; only a token longer than that
 * is cut (`cutsToken`), and both of its sides are then redacted.
 */
export function splitLongLine(text: string): {
  head: string;
  rest: string;
  cutsToken: boolean;
} {
  const bytes = Buffer.from(text, "utf8");
  let cut = MAX_LINE_BYTES;
  while (cut > 0 && ((bytes[cut] ?? 0) & 0xc0) === 0x80) cut--;
  const hard = bytes.subarray(0, cut).toString("utf8");
  const window = hard.slice(-SPLIT_OVERLAP);
  const base = hard.length - window.length;
  let at = window.lastIndexOf(" ");
  if (at === -1)
    for (let index = window.length - 1; index >= 0; index--)
      if (!TOKEN_CHARACTER.test(window[index] as string)) {
        at = index;
        break;
      }
  if (at !== -1 && base + at + 1 > 0) {
    const end = base + at + 1;
    return {
      head: hard.slice(0, end),
      rest: text.slice(end),
      cutsToken: false,
    };
  }
  const rest = text.slice(hard.length);
  return {
    head: hard,
    rest,
    cutsToken:
      TOKEN_CHARACTER.test(hard.at(-1) ?? "") &&
      TOKEN_CHARACTER.test(rest[0] ?? ""),
  };
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
    await secureWindowsOwnerOnly(directory, true);
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
  private readonly sensitive: (text: string) => boolean;

  constructor(
    readonly file: string,
    options: LogOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
    this.keep = options.keep ?? LOG_KEEP;
    this.redact = options.redact ?? ((line) => line);
    this.sensitive = options.sensitive ?? (() => false);
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

  /**
   * A line splitter for one output stream of a child. A line longer than
   * MAX_LINE_BYTES is written in pieces cut on a UTF-8 boundary, preferably
   * at a space or another character no token contains, so a key or a known
   * secret is never cut in two. The pieces overlap for the credential check:
   * a credential word in the last or next SPLIT_OVERLAP bytes around a cut, or
   * in an earlier piece of the same line, omits the piece. A token longer
   * than the overlap that has to be cut is redacted on both sides.
   */
  stream(): { write(chunk: Buffer | string): void; end(): void } {
    let pending = "";
    let sensitiveLine = false;
    let insideToken = false;
    const decoder = new StringDecoder("utf8");
    const finish = (text: string) => {
      this.piece(text, sensitiveLine, insideToken);
      sensitiveLine = false;
      insideToken = false;
    };
    return {
      write: (chunk) => {
        pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
        let index = pending.search(/\r?\n/);
        while (index !== -1) {
          finish(pending.slice(0, index));
          pending = pending.slice(index + (pending[index] === "\r" ? 2 : 1));
          index = pending.search(/\r?\n/);
        }
        while (Buffer.byteLength(pending) > MAX_LINE_BYTES) {
          const { head, rest, cutsToken } = splitLongLine(pending);
          const around = `${head.slice(-SPLIT_OVERLAP)}${rest.slice(0, SPLIT_OVERLAP)}`;
          if (this.sensitive(head) || this.sensitive(around))
            sensitiveLine = true;
          this.piece(head, sensitiveLine, insideToken);
          insideToken = cutsToken;
          pending = rest;
        }
      },
      end: () => {
        pending += decoder.end();
        if (pending || sensitiveLine || insideToken) finish(pending);
        pending = "";
      },
    };
  }

  /** Write one piece of a line, with what earlier pieces decided. */
  private piece(text: string, sensitive: boolean, insideToken: boolean): void {
    if (sensitive) {
      this.line(SENSITIVE_LINE_MARK);
      return;
    }
    if (insideToken) {
      // The start of this piece continues a token already longer than the
      // overlap: it is a value, whatever the length of what is left of it.
      const run = /^[A-Za-z0-9_+/=-]+/.exec(text)?.[0].length ?? 0;
      if (run > 0) text = `[REDACTED value]${text.slice(run)}`;
    }
    this.line(text);
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
    sensitive: sensitiveLogLine,
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
