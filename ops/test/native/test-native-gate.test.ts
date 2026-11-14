import { expect, it } from "vitest";
import { phaseVerdict } from "../../test-native.js";

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
