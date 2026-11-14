import { existsSync, rmSync } from "node:fs";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import type { Items, Ledger } from "./ledger.js";

// A credit ledger in a TSV file with a hard cap, for paid runs outside the job database (the
// music-video rung runs). It implements the worker's `Ledger`, so paid calls go through the same
// `paidCall` / `openPaidEntry` reservation path as the jobs: a reservation is written before the
// call, refused when reserved-plus-spent would pass the cap, and settled with the real amount.
//
// Rows: time, entry, model, units, estimated, actual, running_total, note. The running total
// counts a reservation at its estimate until it is settled, so a crash mid-call still holds the
// credits. Lines starting with "#" are the header (prices and cap).
export const CAP_REFUSAL_CODE = "MDF02";

export class CapRefused extends Error {
  readonly code = CAP_REFUSAL_CODE;
}

type Row = {
  entry: string;
  model: string;
  units: string;
  estimated: number;
  actual: number | null;
};

const HEAD =
  "time\tentry\tmodel\tunits\testimated\tactual\trunning_total\tnote";

function fmt(n: number) {
  return String(Math.round(n * 100) / 100);
}

// The highest cap a run may set, in credits.
export const MAX_CAP = 5000;

// A cap from the command line or a caller: a finite number above 0 and at most MAX_CAP.
export function validCap(value: string | number): number {
  const cap =
    typeof value === "number"
      ? value
      : value.trim() === ""
        ? Number.NaN
        : Number(value);
  if (!Number.isFinite(cap) || cap <= 0 || cap > MAX_CAP)
    throw new Error(
      `cap_invalid: the cap must be a number above 0 and at most ${MAX_CAP} credits, got "${String(value)}"`,
    );
  return cap;
}

// True when a process with this id runs (EPERM: it runs under another user).
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class TsvCapLedger implements Ledger {
  private rows = new Map<string, Row>();
  // The read in progress or done, shared by every caller (a failed read stays failed).
  private loading: Promise<void> | null = null;
  private serial = 0;
  private locked = false;
  // Reservations and settlements of this process, one at a time.
  private queue: Promise<unknown> = Promise.resolve();
  readonly cap: number;

  constructor(
    private readonly file: string,
    cap: number,
    private readonly header: string[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.cap = validCap(cap);
  }

  private get lockFile() {
    return `${this.file}.lock`;
  }

  // The exclusive lock of a paid run: a lock file with this process id, created only when absent.
  // A lock left by a process that is gone is taken over; a live one refuses the run.
  async lock(): Promise<void> {
    if (this.locked) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await writeFile(this.lockFile, String(process.pid), { flag: "wx" });
        this.locked = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const text = await readFile(this.lockFile, "utf8").catch(() => "");
      const pid = Number(text.trim());
      if (
        !Number.isInteger(pid) ||
        pid <= 0 ||
        pid === process.pid ||
        alive(pid)
      )
        throw new Error(
          `ledger ${this.file} is locked by process ${text.trim() || "unknown"}: another paid run uses it (delete ${this.lockFile} only if no run is going)`,
        );
      await rm(this.lockFile, { force: true });
    }
    throw new Error(`ledger ${this.file}: the lock could not be taken`);
  }

  async unlock(): Promise<void> {
    if (!this.locked) return;
    this.locked = false;
    await rm(this.lockFile, { force: true });
  }

  // For a process "exit" handler, where only synchronous work runs.
  unlockSync(): void {
    if (!this.locked) return;
    this.locked = false;
    rmSync(this.lockFile, { force: true });
  }

  private requireLock() {
    if (!this.locked)
      throw new Error(
        `ledger ${this.file} must be locked (lock()) before a paid call`,
      );
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return run;
  }

  private load(): Promise<void> {
    this.loading ??= this.read();
    return this.loading;
  }

  // Reads the file again (under the lock, so no other run writes it meanwhile).
  private reload(): Promise<void> {
    this.loading = this.read();
    return this.loading;
  }

  private async read() {
    this.rows = new Map();
    this.serial = 0;
    if (!existsSync(this.file)) {
      try {
        await writeFile(
          this.file,
          `${[...this.header.map((h) => `# ${h}`), `# cap\t${this.cap}`, HEAD].join("\n")}\n`,
          { flag: "wx" },
        );
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const lines = (await readFile(this.file, "utf8")).split(/\r?\n/u);
    // The cap the ledger was started with: a run may not change it.
    const capLine = lines.find((l) => l.startsWith("# cap\t"));
    const fileCap = capLine ? Number(capLine.slice("# cap\t".length)) : null;
    if (fileCap !== this.cap)
      throw new Error(
        `cap_mismatch: the run asks for cap ${this.cap} but ledger ${this.file} ${fileCap === null ? "has no cap line" : `was started with cap ${fileCap}`}`,
      );
    for (const [index, line] of lines.entries()) {
      if (!line || line.startsWith("#") || line.startsWith("time\t")) continue;
      const [, entry, model, units, estimated, actual] = line.split("\t");
      if (!entry || entry === "-") continue;
      // A row the ledger cannot read would count as nothing: refuse the file instead.
      const credits = (value: string | undefined) => {
        const n =
          value === undefined || value.trim() === ""
            ? Number.NaN
            : Number(value);
        if (!Number.isFinite(n) || n < 0)
          throw new Error(
            `ledger ${this.file} is damaged at line ${index + 1}: credits "${value ?? ""}" are not a number; fix the file by hand`,
          );
        return n;
      };
      const row = this.rows.get(entry) ?? {
        entry,
        model: model ?? "",
        units: units ?? "",
        estimated: credits(estimated),
        actual: null,
      };
      if (actual !== undefined && actual !== "") row.actual = credits(actual);
      this.rows.set(entry, row);
      this.serial = Math.max(this.serial, Number(entry.slice(1)) || 0);
    }
  }

  // Credits held: settled calls at their real cost, open reservations at their estimate.
  async total(): Promise<number> {
    await this.load();
    let sum = 0;
    for (const row of this.rows.values()) sum += row.actual ?? row.estimated;
    return Math.round(sum * 100) / 100;
  }

  private async write(row: Row, note: string) {
    const total = await this.total();
    await appendFile(
      this.file,
      `${[
        this.now().toISOString(),
        row.entry,
        row.model,
        row.units,
        fmt(row.estimated),
        row.actual === null ? "" : fmt(row.actual),
        fmt(total),
        note.replace(/[\t\r\n]+/gu, " "),
      ].join("\t")}\n`,
    );
  }

  // Ledger.open: `key` is "model|units" and `items.credits` the estimate.
  async open(key: string, items: Items): Promise<string> {
    this.requireLock();
    return this.exclusive(async () => {
      await this.reload();
      const estimated = items.credits;
      if (
        estimated === undefined ||
        !Number.isFinite(estimated) ||
        estimated < 0
      )
        throw new Error("a reservation needs its estimated credits");
      const before = await this.total();
      const [model = key, units = ""] = key.split("|");
      if (before + estimated > this.cap + 1e-9)
        throw new CapRefused(
          `cap_exceeded: ${model} needs ${fmt(estimated)} credits, ${fmt(before)} of ${this.cap} already held`,
        );
      this.serial++;
      const entry = `e${String(this.serial).padStart(3, "0")}`;
      const row: Row = { entry, model, units, estimated, actual: null };
      this.rows.set(entry, row);
      await this.write(row, "reserved");
      return entry;
    });
  }

  async settle(entryId: string, items: Items): Promise<void> {
    this.requireLock();
    return this.exclusive(async () => {
      await this.load();
      const row = this.rows.get(entryId);
      if (!row) throw new Error(`unknown ledger entry ${entryId}`);
      const actual = items.credits;
      if (actual === undefined || !Number.isFinite(actual) || actual < 0)
        throw new Error("a settlement needs the credits actually spent");
      row.actual = actual;
      await this.write(row, "settled");
    });
  }

  // A note row that does not hold credits (a refusal, a balance check, a stop).
  async note(text: string): Promise<void> {
    await this.load();
    await appendFile(
      this.file,
      `${[this.now().toISOString(), "-", "-", "-", "", "", fmt(await this.total()), text.replace(/[\t\r\n]+/gu, " ")].join("\t")}\n`,
    );
  }

  async reservationFor(): Promise<string | null> {
    return "tsv";
  }
  async extend(): Promise<void> {
    throw new CapRefused("cap_exceeded: the TSV ledger has a fixed cap");
  }
  async extendStage(): Promise<void> {}
  async markAmbiguous(): Promise<void> {}
}
