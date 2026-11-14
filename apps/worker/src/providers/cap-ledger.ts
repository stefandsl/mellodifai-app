import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
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

export class TsvCapLedger implements Ledger {
  private rows = new Map<string, Row>();
  private loaded = false;
  private serial = 0;

  constructor(
    private readonly file: string,
    readonly cap: number,
    private readonly header: string[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.file)) {
      await writeFile(
        this.file,
        `${[...this.header.map((h) => `# ${h}`), `# cap\t${this.cap}`, HEAD].join("\n")}\n`,
      );
      return;
    }
    for (const line of (await readFile(this.file, "utf8")).split(/\r?\n/u)) {
      if (!line || line.startsWith("#") || line.startsWith("time\t")) continue;
      const [, entry, model, units, estimated, actual] = line.split("\t");
      if (!entry || entry === "-") continue;
      const row = this.rows.get(entry) ?? {
        entry,
        model: model ?? "",
        units: units ?? "",
        estimated: Number(estimated),
        actual: null,
      };
      if (actual !== undefined && actual !== "") row.actual = Number(actual);
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
    await this.load();
    const estimated = items.credits;
    if (estimated === undefined || !Number.isFinite(estimated) || estimated < 0)
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
  }

  async settle(entryId: string, items: Items): Promise<void> {
    await this.load();
    const row = this.rows.get(entryId);
    if (!row) throw new Error(`unknown ledger entry ${entryId}`);
    const actual = items.credits;
    if (actual === undefined || !Number.isFinite(actual) || actual < 0)
      throw new Error("a settlement needs the credits actually spent");
    row.actual = actual;
    await this.write(row, "settled");
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
