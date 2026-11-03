import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { kieAllowed } from "../src/kie/guard.js";
import type { StageContext } from "../src/loop.js";
import { type Ledger, serviceLedger } from "../src/providers/ledger.js";
import { callKey, freeCall, paidCall } from "../src/providers/paid.js";

describe("paid provider calls", () => {
  it("call keys carry the job attempt (Major 7)", () => {
    expect(callKey("groq", { takeId: "t1", attempt: 2 })).toBe("groq:t1:a2");
    expect(callKey("kie", { op: "generate", attempt: 2 })).toBe(
      "kie:generate:2",
    );
    expect(
      callKey("openrouter", { role: "writer", round: 1, n: 3, attempt: 2 }),
    ).toBe("openrouter:writer:1:3:a2");
  });

  it("paidCall opens before and settles after; on MDF07 it extends once then reopens (Major 8)", async () => {
    const calls: string[] = [];
    const ledger = {
      reservationFor: vi.fn(),
      open: vi
        .fn()
        .mockImplementationOnce(async () => {
          calls.push("open");
          throw { code: "MDF07" };
        })
        .mockImplementationOnce(async () => {
          calls.push("reopen");
          return "entry";
        }),
      extend: vi.fn(async () => {
        calls.push("extend");
      }),
      settle: vi.fn(async () => {
        calls.push("settle");
      }),
    } satisfies Ledger;
    const result = await paidCall(
      ledger,
      "kie:generate:2",
      { credit: 12 },
      async () => {
        calls.push("run");
        return { result: "task", items: { credit: 12 } };
      },
    );
    expect(result).toBe("task");
    expect(calls).toEqual(["open", "extend", "reopen", "run", "settle"]);
    expect(ledger.settle).toHaveBeenCalledWith(
      "entry",
      { credit: 12 },
      undefined,
    );
  });

  it("a free call carries no entry", async () => {
    const result = await freeCall("kie:credit", async () => 42);
    expect(result).toBe(42);
  });

  it("uses the ops service schema and permits a null free-job reservation", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === "reserve_job" ? null : "entry",
      error: null,
    }));
    const schema = vi.fn(() => ({ rpc }));
    const ledger = serviceLedger(
      { schema } as unknown as SupabaseClient,
      null,
      "kie",
      "",
    );
    expect(await ledger.reservationFor("job")).toBeNull();
    expect(schema).toHaveBeenCalledWith("ops");
    expect(rpc).toHaveBeenCalledWith("reserve_job", { p_job: "job" });
    await expect(ledger.open("kie:generate:1", { credit: 12 })).rejects.toThrow(
      "no reservation",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("opens against the reservation returned for an existing job", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === "reserve_job" ? "reservation" : "entry",
      error: null,
    }));
    const ledger = serviceLedger(
      { schema: () => ({ rpc }) } as unknown as SupabaseClient,
      null,
      "kie",
      "",
    );
    expect(await ledger.reservationFor("job")).toBe("reservation");
    expect(await ledger.open("kie:generate:1", { credit: 12 })).toBe("entry");
    expect(rpc).toHaveBeenLastCalledWith("spend_entry_open", {
      p_reservation: "reservation",
      p_call_key: "kie:generate:1",
      p_provider: "kie",
      p_model: "",
      p_items_est: { credit: 12 },
    });
  });

  it("keeps an entry open when the provider outcome is unknown", async () => {
    const ledger = {
      reservationFor: vi.fn(),
      open: vi.fn(async () => "entry"),
      extend: vi.fn(),
      settle: vi.fn(),
    } satisfies Ledger;
    await expect(
      paidCall(ledger, "kie:generate:1", { credit: 12 }, async () => {
        throw new Error("unknown outcome");
      }),
    ).rejects.toThrow("unknown outcome");
    expect(ledger.settle).not.toHaveBeenCalled();
  });

  it("kie/guard.ts still refuses .test owners without ALLOW_TEST_KIE (Major 25)", async () => {
    const context = {
      secrets: { values: { ALLOW_TEST_KIE: "0" } },
      project: { song_settings: null, owner_id: "owner" },
      version: { owner_id: "owner" },
      db: { getOwnerEmail: async () => "owner@example.test" },
    } as unknown as StageContext;
    expect(await kieAllowed(context)).toBe(false);
  });
});
