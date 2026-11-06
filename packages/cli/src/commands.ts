import { parseArgs } from "node:util";
import { ClientError, request } from "./client.js";
import type { Credentials } from "./credentials.js";

export const commands = [
  "login",
  "songs",
  "create",
  "status",
  "approve",
  "regenerate",
  "video",
  "costs",
  "mcp",
];
export const options = {
  json: { type: "boolean" },
  help: { type: "boolean" },
  watch: { type: "boolean" },
  url: { type: "string" },
  input: { type: "string" },
  "idempotency-key": { type: "string" },
} as const;
export function parse(args: string[]) {
  return parseArgs({ args, allowPositionals: true, options });
}
export type CommandIO = {
  credentials: Credentials;
  input: (file?: string) => Promise<unknown>;
  output: (value: unknown) => void;
};

export async function run(args: string[], io: CommandIO): Promise<void> {
  const { values, positionals } = parse(args);
  const [command, id] = positionals;
  if (
    !command ||
    !commands.includes(command) ||
    positionals.length > 2 ||
    values.url ||
    (values.watch && command !== "status")
  )
    throw new ClientError(
      "validation",
      "Comando o opzioni non validi. Usa --help.",
    );
  if (
    ["status", "approve", "regenerate", "video"].includes(command)
      ? !id
      : Boolean(id)
  )
    throw new ClientError("validation", "Identificatore mancante o inatteso.");
  const version = encodeURIComponent(id ?? "");
  let path: string;
  let body: unknown;
  switch (command) {
    case "songs":
    case "costs": {
      path = `/${command}`;
      if (values.input) {
        const query = await io.input(values.input);
        if (!query || typeof query !== "object" || Array.isArray(query))
          throw new ClientError("validation", "Filtri JSON non validi.");
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
          if (!["string", "number", "boolean"].includes(typeof value))
            throw new ClientError("validation", "Filtri JSON non validi.");
          params.set(key, String(value));
        }
        path += `?${params}`;
      }
      break;
    }
    case "create":
      path = "/songs";
      body = await io.input(values.input);
      break;
    case "approve":
      path = `/songs/${version}/lyrics/approve`;
      body = await io.input(values.input);
      break;
    case "regenerate":
      path = `/songs/${version}/generate`;
      body = await io.input(values.input);
      break;
    case "video":
      path = `/songs/${version}/video`;
      body = {};
      break;
    case "status":
      path = `/jobs/${version}`;
      break;
    default:
      throw new ClientError("validation", "Usa il comando dalla CLI.");
  }
  do {
    const result = await request(
      io.credentials,
      path,
      body,
      values["idempotency-key"],
    );
    io.output(result);
    if (!values.watch) return;
    const status = (result as { data?: { job?: { status?: string } } }).data
      ?.job?.status;
    if (["done", "failed", "cancelled"].includes(status ?? "")) return;
    if (status !== "queued" && status !== "running")
      throw new ClientError("internal", "Stato del job non valido.");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } while (values.watch);
}
