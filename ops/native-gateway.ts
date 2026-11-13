import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGateway,
  type GatewayConfig,
  parseGatewayConfig,
} from "./lib/native/gateway.js";

// Requests still running after this long are cut so a stop always finishes.
const SHUTDOWN_GRACE_MS = 10_000;

/** Process events share stdout with the request lines, one JSON object each. */
function report(event: string, detail: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), event, ...detail })}\n`,
  );
}

/**
 * Reads the private config file. Errors say what is wrong without quoting the
 * file: a JSON syntax error would otherwise print the text around it.
 */
export function loadGatewayConfig(path: string | undefined): GatewayConfig {
  if (!path || !isAbsolute(path))
    throw new Error(
      "MDF_GATEWAY_CONFIG must be the absolute path of the gateway config file",
    );
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read the gateway config file (${(error as NodeJS.ErrnoException).code ?? "error"})`,
    );
  }
  let value: unknown;
  try {
    // PowerShell writes a byte-order mark first; it is not part of the JSON.
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new Error("The gateway config file is not valid JSON");
  }
  return parseGatewayConfig(value);
}

/**
 * Starts the gateway and wires its stop. A stop first refuses new connections
 * and lets running requests finish; a second stop, or the grace period, cuts
 * them. The gateway keeps no state, so a hard kill loses nothing either.
 *
 * Stops come from SIGINT and SIGTERM, from Ctrl+Break and a closed console on
 * Windows, and from the supervisor closing the IPC channel (or dying), which
 * is the one graceful stop a Windows parent can send to a windowless child.
 * A supervisor that dies also breaks the log pipe: the gateway then stops
 * instead of crashing on its next line or living on as an orphan.
 */
export function runGateway(config: GatewayConfig): Server {
  const server = createGateway(config);
  let stopping = false;
  const stop = (reason: string) => {
    if (stopping) {
      server.closeAllConnections();
      return;
    }
    stopping = true;
    report("stopping", { reason });
    server.close(() => {
      report("stopped");
      // An open IPC channel would keep the process alive after a signal.
      if (process.connected) process.disconnect();
    });
    setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
  };
  server.on("error", (error: NodeJS.ErrnoException) => {
    report("listener_failed", { code: error.code ?? "error" });
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
  server.on("listening", () => {
    const address = server.address() as AddressInfo;
    report("listening", { host: address.address, port: address.port });
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const)
    process.on(signal, () => stop(signal));
  process.on("disconnect", () => stop("disconnect"));
  let logging = true;
  process.stdout.on("error", () => {
    // Later lines fail the same way; only the first failure is a stop.
    if (!logging) return;
    logging = false;
    stop("log_closed");
  });
  return server.listen(config.port, config.host);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    runGateway(loadGatewayConfig(process.env.MDF_GATEWAY_CONFIG));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}
