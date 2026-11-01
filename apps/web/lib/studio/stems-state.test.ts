import { describe, expect, it } from "vitest";

import { stemsState } from "./clips";

const job = (status: string, take_id = "t1", id = "j1") => ({
  id,
  version_id: "v1",
  status,
  take_id,
});

describe("stemsState", () => {
  it("is nothing without a chosen take or a request", () => {
    expect(stemsState(null, true, [job("done")], null)).toBeNull();
    expect(stemsState("t1", false, [], null)).toBeNull();
    // A job for another take (an older chosen take) says nothing about this one.
    expect(stemsState("t2", false, [job("running")], null)).toBeNull();
  });

  it("follows the job of the chosen take", () => {
    expect(stemsState("t1", false, [job("queued")], 4)).toEqual({
      takeId: "t1",
      status: "queued",
      jobId: "j1",
      queuePosition: 4,
    });
    expect(
      stemsState("t1", false, [job("running")], 4)?.queuePosition,
    ).toBeNull();
    expect(stemsState("t1", false, [job("failed")], null)?.status).toBe(
      "failed",
    );
    expect(stemsState("t1", false, [job("cancelled")], null)?.status).toBe(
      "failed",
    );
    // A finished job whose stems are gone is not "ready".
    expect(stemsState("t1", false, [job("done")], null)).toBeNull();
  });

  it("is ready whenever the take has its stems", () => {
    expect(stemsState("t1", true, [job("failed")], 2)).toEqual({
      takeId: "t1",
      status: "done",
      jobId: "j1",
      queuePosition: null,
    });
  });
});
