import { join } from "node:path";
import { expect, it } from "vitest";
import { testRuntimeRoot } from "./runtime.js";

it("keeps fixtures off the system temp drive and honors the runtime roots", () => {
  expect(testRuntimeRoot({ TEMP: "C:/temp", TMP: "C:/temp" })).toBe(
    join("E:/mellodifai", "tmp", "cli-tests"),
  );
  expect(testRuntimeRoot({ MELLODIFAI_ROOT: "G:/test-runtime" })).toBe(
    join("G:/test-runtime", "tmp", "cli-tests"),
  );
  expect(
    testRuntimeRoot({
      RUNNER_TEMP: "E:/runner",
      MELLODIFAI_ROOT: "G:/test-runtime",
    }),
  ).toBe(join("E:/runner", "tmp", "cli-tests"));
  if (process.platform === "win32") {
    expect(() => testRuntimeRoot({ MELLODIFAI_ROOT: "C:/runtime" })).toThrow(
      /C:/,
    );
  }
});
