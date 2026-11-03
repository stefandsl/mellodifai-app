import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { opsCall } from "./helpers/ops-call";

it("opsCall passes a session context to an ops wrapper", async () => {
  const session = { userId: randomUUID(), sessionId: randomUUID() };
  for (const opts of [undefined, { realCaps: true }]) {
    const result = await opsCall(session, "songs_list", [], opts);
    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
  }
});
