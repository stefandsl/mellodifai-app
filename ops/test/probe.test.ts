import { expect, it, vi } from "vitest";
import { type Runner, recordingRunner } from "../lib/run.js";
import { probe } from "../probe.js";

vi.mock("../rotate-db-passwords.js", () => ({
  inventoryDbLogins: vi.fn(async () => ["postgres", "mdf_web", "mdf_auth"]),
  readDbPasswords: vi.fn(() => ({
    postgres: "private-test",
    mdf_web: "private-web",
    mdf_auth: "private-auth",
  })),
}));
vi.mock("postgres", () => ({
  default: () => Object.assign(async () => [], { end: async () => {} }),
}));
function fixture(openPort?: string, defaultAccepted = false, broken = false) {
  const record = recordingRunner();
  const runner: Runner = async (cmd, args, opts) => {
    await record(cmd, args, opts);
    if (args.includes("bash"))
      return {
        code: openPort && args.includes(openPort) ? 0 : 1,
        stdout: "",
        stderr: "Connection refused",
      };
    if (broken)
      return {
        code: 125,
        stdout: "",
        stderr: "private-test docker unavailable",
      };
    const accepted =
      opts?.env?.PGPASSWORD?.startsWith("private-") || defaultAccepted;
    return {
      code: accepted ? 0 : 2,
      stdout: "",
      stderr:
        'FATAL: password authentication failed for user "postgres" private-test',
    };
  };
  return { record, runner };
}
it("probe fails a role that still accepts the password postgres", async () => {
  const result = await probe("prod", fixture(undefined, true).runner);
  expect(result.ok).toBe(false);
  expect(result.failures).toContain("postgres: default login accepted");
});
it("probe requires 54323, 54324 and 54327 to refuse connections from a container (Major 2)", async () => {
  for (const port of ["54323", "54324", "54327"]) {
    const f = fixture(port);
    expect((await probe("prod", f.runner)).failures).toContain(`${port}: open`);
    expect(
      f.record.calls.every(
        (c) =>
          c.args.includes("host.docker.internal:host-gateway") &&
          c.args.includes("postgres:17"),
      ),
    ).toBe(true);
  }
  expect((await probe("prod", fixture().runner)).ok).toBe(true);
});
it("probe output names roles and ports only, never passwords", async () => {
  const f = fixture(undefined, false, true);
  const result = await probe("prod", f.runner);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("private-");
  expect(JSON.stringify(f.record.calls)).not.toContain("private-");
});
it("does not mistake a container or network failure for a refused login", async () => {
  expect(
    (await probe("prod", fixture(undefined, false, true).runner)).failures,
  ).toContain("postgres: default login unverified");
});

it("fails passwordless app access and distinguishes TCP timeouts from refusal", async () => {
  const f = fixture();
  const runner: Runner = async (cmd, args, opts) => {
    if (args.includes("bash")) return { code: 124, stdout: "", stderr: "" };
    if (opts?.env?.PGPASSWORD === "")
      return { code: 0, stdout: "", stderr: "" };
    return f.runner(cmd, args, opts);
  };
  const result = await probe("prod", runner);
  expect(result.failures).toEqual(
    expect.arrayContaining([
      "mdf_web: empty login accepted",
      "mdf_auth: empty login accepted",
      "54323: refusal unverified",
      "54324: refusal unverified",
      "54327: refusal unverified",
    ]),
  );
});
