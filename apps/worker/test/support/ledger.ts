import { vi } from "vitest";
import type { Ledger } from "../../src/providers/ledger.js";

export function recordingLedger(): Ledger {
  return {
    extendStage: vi.fn(async () => {}),
    reservationFor: vi.fn(async () => "reservation"),
    open: vi.fn(async () => "entry"),
    extend: vi.fn(async () => {}),
    settle: vi.fn(async () => {}),
  };
}
