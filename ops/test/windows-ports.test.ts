import { expect, it, vi } from "vitest";
import { ENV_TABLE } from "../lib/envs.js";
import { recordingRunner } from "../lib/run.js";
import {
  assertWindowsPorts,
  excludedPortRanges,
} from "../lib/windows-ports.js";
import { runStackCommand } from "../stack.js";

const exclusions =
  "Intervalli di esclusione porte TCP\nPorta iniziale Porta finale\n------------- -----------\n  44300 44320 *\n  54231 54330\n";
it("parses localized netsh output and administered ranges", () => {
  expect(excludedPortRanges(exclusions)).toEqual([
    [44300, 44320],
    [54231, 54330],
  ]);
  expect(excludedPortRanges("Start End\n----- -----\n")).toEqual([]);
  expect(() => excludedPortRanges("unrecognized output")).toThrow();
});
it("accepts production and e2e outside reserved ranges", async () => {
  for (const env of ["prod", "e2e"] as const) {
    const runner = recordingRunner([
      { code: 0, stdout: exclusions, stderr: "" },
    ]);
    await assertWindowsPorts(ENV_TABLE[env], runner, "win32");
    expect(runner.calls[0]?.args).toEqual([
      "interface",
      "ipv4",
      "show",
      "excludedportrange",
      "protocol=tcp",
    ]);
  }
});
it.each([49152, 65535, 54321])(
  "refuses dynamic port %s including disabled listener configuration",
  async (port) => {
    await expect(
      assertWindowsPorts(
        {
          ...ENV_TABLE.prod,
          listeners: { ...ENV_TABLE.prod.listeners, shadow: port },
        },
        recordingRunner(),
        "win32",
      ),
    ).rejects.toThrow("dynamic TCP range 49152-65535");
  },
);
it.each([44321, 44322, 44326, 44328, 44329])(
  "refuses excluded port %s inclusively",
  async (port) => {
    const runner = recordingRunner([
      {
        code: 0,
        stdout: `Start End\n----- -----\n${port} ${port} *\n`,
        stderr: "",
      },
    ]);
    await expect(
      assertWindowsPorts(ENV_TABLE.prod, runner, "win32"),
    ).rejects.toThrow(`configured port ${port}`);
  },
);
it("fails closed without exposing failed netsh output", async () => {
  const runner = recordingRunner([
    { code: 1, stdout: "private", stderr: "private" },
  ]);
  await expect(
    assertWindowsPorts(ENV_TABLE.prod, runner, "win32"),
  ).rejects.toThrow("Cannot query Windows TCP exclusions");
});
it("does not run netsh on other platforms", async () => {
  const runner = recordingRunner();
  await assertWindowsPorts(ENV_TABLE.ci, runner, "linux");
  expect(runner.calls).toEqual([]);
});
it("refuses start before rendering, Docker or migrations", async () => {
  const render = vi.fn();
  const execute = vi.fn();
  const migrate = vi.fn();
  await expect(
    runStackCommand(
      "start",
      "prod",
      {},
      {
        checkPorts: () =>
          assertWindowsPorts(ENV_TABLE.dev, recordingRunner(), "win32"),
        render,
        execute,
        migrate,
        passwords: vi.fn(),
        envFile: vi.fn(),
      },
    ),
  ).rejects.toThrow("Windows stack start refused");
  expect(render).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(migrate).not.toHaveBeenCalled();
});
