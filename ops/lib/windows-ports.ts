import type { StackValues } from "./envs.js";
import type { Runner } from "./run.js";

export function excludedPortRanges(output: string): [number, number][] {
  const ranges: [number, number][] = [];
  // netsh headings are localized; numeric rows and the separator are stable.
  if (!/^\s*-{3,}\s+-{3,}\s*$/m.test(output))
    throw new Error("Cannot read Windows TCP exclusions; stack start refused");
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s*\*?\s*$/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start < 1 || end > 65535 || start > end)
      throw new Error("Invalid Windows TCP exclusion; stack start refused");
    ranges.push([start, end]);
  }
  return ranges;
}

export async function assertWindowsPorts(
  values: Pick<StackValues, "ports" | "listeners">,
  runner: Runner,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== "win32") return;
  const ports = [
    ...Object.values(values.ports),
    ...Object.values(values.listeners),
  ].filter((port): port is number => port !== null);
  const dynamic = ports.filter((port) => port >= 49152 && port <= 65535);
  if (dynamic.length)
    throw new Error(
      `Windows stack start refused: configured ports ${dynamic.join(", ")} fall inside dynamic TCP range 49152-65535. Choose ports outside that range in ops/lib/envs.ts.`,
    );
  let output: string;
  try {
    const result = await runner("netsh", [
      "interface",
      "ipv4",
      "show",
      "excludedportrange",
      "protocol=tcp",
    ]);
    if (result.code !== 0) throw new Error();
    output = result.stdout;
  } catch {
    throw new Error(
      "Cannot query Windows TCP exclusions; stack start refused. Run netsh interface ipv4 show excludedportrange protocol=tcp.",
    );
  }
  const ranges = excludedPortRanges(output);
  for (const port of ports) {
    const range = ranges.find(([start, end]) => port >= start && port <= end);
    if (range)
      throw new Error(
        `Windows stack start refused: configured port ${port} is in excluded TCP range ${range[0]}-${range[1]}. Choose an unreserved port in ops/lib/envs.ts; inspect netsh interface ipv4 show excludedportrange protocol=tcp.`,
      );
  }
}
