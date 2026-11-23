import { expect, it } from "vitest";
import { expectRefusedLogin } from "../../lib/native/postgres.js";

const failure = (code: string) => Object.assign(new Error(code), { code });

function connections(outcomes: (string | "accepted")[]) {
  let opened = 0;
  let ended = 0;
  return {
    open: () => {
      const outcome = outcomes[opened++];
      return {
        query: async () => {
          if (outcome === "accepted") return [{ "?column?": 1 }];
          throw failure(outcome as string);
        },
        end: async () => {
          ended++;
        },
      };
    },
    counts: () => ({ opened, ended }),
  };
}

it("accepts a refusal that arrives after resets, and closes every attempt", async () => {
  const probe = connections(["ECONNRESET", "ECONNRESET", "28P01"]);
  await expectRefusedLogin(probe.open);
  expect(probe.counts()).toEqual({ opened: 3, ended: 3 });
});

it("fails when the default password is accepted, without retrying", async () => {
  const probe = connections(["accepted", "28P01"]);
  await expect(expectRefusedLogin(probe.open)).rejects.toThrow(
    "Default database password remains accepted",
  );
  expect(probe.counts()).toEqual({ opened: 1, ended: 1 });
});

it("fails on any other error at once, and on resets that never stop", async () => {
  const other = connections(["ECONNREFUSED", "28P01"]);
  await expect(expectRefusedLogin(other.open)).rejects.toMatchObject({
    code: "ECONNREFUSED",
  });
  expect(other.counts().opened).toBe(1);
  const resets = connections([
    "ECONNRESET",
    "ECONNRESET",
    "ECONNRESET",
    "28P01",
  ]);
  await expect(expectRefusedLogin(resets.open)).rejects.toMatchObject({
    code: "ECONNRESET",
  });
  expect(resets.counts().opened).toBe(3);
});
