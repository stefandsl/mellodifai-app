import { expect, it } from "vitest";
import { realRunner, recordingRunner } from "../lib/run.js";

it("records commands in order and returns supplied replies then success", async () => {
  const runner = recordingRunner([{ code: 2, stdout: "out", stderr: "err" }]);
  const args = ["one"];
  expect(await runner("tool", args)).toEqual({
    code: 2,
    stdout: "out",
    stderr: "err",
  });
  args.push("two");
  expect(await runner("next", [])).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(runner.calls).toEqual([
    { cmd: "tool", args: ["one"] },
    { cmd: "next", args: [] },
  ]);
});

it("captures exit status and streams with cwd, environment and stdin", async () => {
  const result = await realRunner(
    process.execPath,
    [
      "-e",
      `
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', data => process.stdout.write(process.env.OPS_RUN_TEST + data));
    process.stdin.on('end', () => {
      process.stderr.write(process.cwd());
      process.exitCode = 3;
    });
  `,
    ],
    {
      cwd: import.meta.dirname,
      env: { OPS_RUN_TEST: "test:" },
      input: "input",
    },
  );
  expect(result).toEqual({
    code: 3,
    stdout: "test:input",
    stderr: import.meta.dirname,
  });
});

it("rejects when a command cannot be started", async () => {
  await expect(
    realRunner("missing-ops-command-7298", []),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
