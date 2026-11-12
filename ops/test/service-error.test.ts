import { expect, it } from "vitest";
import { recordingRunner } from "../lib/run.js";
import { serviceErrorMessage } from "../lib/service-error.js";
import { serviceCommand } from "../lib/services.js";

it.each([
  undefined,
  null,
  {},
  new Error("postgresql://owner:private@localhost/db"),
  new AggregateError([]),
])("always reports a nonempty, credential-free failure for %s", (error) => {
  const message = serviceErrorMessage(error);
  expect(message).toContain("Service command failed:");
  expect(message).not.toMatch(/undefined|private|postgresql:/);
});

it("reports the actual connection failure without exposing its message", () => {
  const error = Object.assign(new Error("secret connection string"), {
    code: "ECONNREFUSED",
  });
  expect(serviceErrorMessage(new AggregateError([error]))).toContain(
    "ECONNREFUSED",
  );
  expect(serviceErrorMessage(error)).toContain("Windows excluded port ranges");
  expect(serviceErrorMessage(error)).not.toContain("secret");
});

it("retains the failed service and exit code but discards child credentials", async () => {
  const runner = recordingRunner([
    { code: 7, stdout: "private key", stderr: "private password" },
  ]);
  await expect(serviceCommand(runner, "start", "web")).rejects.toThrow(
    "Service start failed: web (exit 7)",
  );
  try {
    await serviceCommand(
      recordingRunner([{ code: 7, stdout: "private", stderr: "private" }]),
      "start",
      "web",
    );
  } catch (error) {
    expect(serviceErrorMessage(error)).not.toContain("private");
  }
});
