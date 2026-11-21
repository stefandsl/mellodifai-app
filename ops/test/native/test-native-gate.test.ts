import { expect, it } from "vitest";
import { ledgerHead } from "../../lib/native/identity.js";
import {
  phaseVerdict,
  rehearsalEnvironment,
  rehearsalMigrationCount,
} from "../../test-native.js";

it("finds the release of the rehearsal lab's ledger among this checkout's migrations", () => {
  const files = ["1", "2", "3"].map((version) => ({
    version,
    name: `m${version}`,
    sql: "",
    sha256: version.repeat(64),
  }));
  expect(rehearsalMigrationCount(files, ledgerHead(files.slice(0, 2)))).toBe(2);
  expect(rehearsalMigrationCount(files, ledgerHead(files))).toBe(3);
  // A ledger that is not a leading run of these files is another schema.
  expect(() =>
    rehearsalMigrationCount(files, ledgerHead(files.slice(1))),
  ).toThrow(/rebuild the rehearsal lab/);
});

it("runs the rehearsal phase on the rehearsal root with the first root's artifact cache", () => {
  const env = rehearsalEnvironment(
    {
      MELLODIFAI_ROOT: "E:/first-root",
      MDF_NATIVE_INTEGRATION: "1",
      KEEP: "x",
    },
    "E:/first-root/cache/native",
  );
  expect(env).toEqual({
    KEEP: "x",
    MDF_NATIVE_INTEGRATION: "",
    MDF_NATIVE_REHEARSAL: "1",
    MELLODIFAI_ROOT: "E:/mellodifai/native-lab-prod",
    MDF_NATIVE_REHEARSAL_PORT_BASE: "46300",
    MELLODIFAI_NATIVE_CACHE: "E:/first-root/cache/native",
  });
});

const report = (counts: Partial<Record<string, number>>) =>
  JSON.stringify({
    testResults: [{}, {}],
    numTotalTests: 3,
    numPassedTests: 3,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    ...counts,
  });

it("fails a native phase in which a required test skipped", () => {
  expect(phaseVerdict("e2e", report({})).problem).toBeUndefined();
  expect(
    phaseVerdict("e2e", report({ numPassedTests: 2, numPendingTests: 1 }))
      .problem,
  ).toBe("e2e: 1 required test(s) skipped");
  expect(
    phaseVerdict("rehearsal", report({ numPassedTests: 2, numTodoTests: 1 }))
      .problem,
  ).toBe("rehearsal: 1 required test(s) skipped");
  expect(
    phaseVerdict("e2e", report({ numTotalTests: 0, numPassedTests: 0 }))
      .problem,
  ).toBe("e2e: no test ran");
});
