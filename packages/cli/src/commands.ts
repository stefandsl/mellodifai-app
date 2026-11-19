import { parseArgs } from "node:util";
import { ClientError, request } from "./client.js";
import type { Credentials } from "./credentials.js";
import { callTool, listTools } from "./mcp.js";

export const commands = [
  "login",
  "songs",
  "create",
  "status",
  "approve",
  "regenerate",
  "video",
  "pick",
  "approve-video",
  "costs",
  "remake",
  "remakes",
  "remake-status",
  "remake-edit",
  "remake-accept",
  "remake-cancel",
  "remake-retry",
  "publish-plan",
  "publish-status",
  "publish-preview",
  "publish-edit",
  "publish-schedule",
  "publish-request",
  "publish-veto",
  "publish-cancel",
  "tools",
  "call",
  "mcp",
];
export const options = {
  json: { type: "boolean" },
  help: { type: "boolean" },
  watch: { type: "boolean" },
  url: { type: "string" },
  input: { type: "string" },
  lang: { type: "string" },
  country: { type: "string" },
  "idempotency-key": { type: "string" },
} as const;
export function parse(args: string[]) {
  return parseArgs({ args, allowPositionals: true, options });
}
export type CommandIO = {
  credentials: Credentials;
  input: (file?: string) => Promise<unknown>;
  output: (value: unknown) => void;
  /** Milliseconds between --watch polls; 3000 unless a test injects another. */
  interval?: number;
};

/** Positional arguments each command takes after its name. */
const arity: Record<string, number> = {
  songs: 0,
  costs: 0,
  create: 0,
  remakes: 0,
  tools: 0,
  status: 1,
  approve: 1,
  regenerate: 1,
  video: 1,
  "approve-video": 1,
  remake: 1,
  "remake-status": 1,
  "remake-edit": 1,
  "remake-accept": 1,
  "remake-cancel": 1,
  "remake-retry": 1,
  call: 1,
  pick: 2,
  "publish-plan": 1,
  "publish-status": 1,
  "publish-preview": 1,
  "publish-edit": 1,
  "publish-schedule": 2,
  "publish-request": 1,
  "publish-veto": 1,
  "publish-cancel": 1,
};
const watchable = ["status", "remake-status"];

async function query(path: string, io: CommandIO, file?: string) {
  if (!file) return path;
  const filters = await io.input(file);
  if (!filters || typeof filters !== "object" || Array.isArray(filters))
    throw new ClientError("validation", "Filtri JSON non validi.");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!["string", "number", "boolean"].includes(typeof value))
      throw new ClientError("validation", "Filtri JSON non validi.");
    params.set(key, String(value));
  }
  return `${path}?${params}`;
}

/** True when a --watch poll may stop on this response. */
function settled(command: string, result: unknown): boolean {
  const data = (result as { data?: Record<string, unknown> }).data;
  if (command === "status") {
    const status = (data?.job as { status?: string } | undefined)?.status;
    if (["done", "failed", "cancelled"].includes(status ?? "")) return true;
    if (status !== "queued" && status !== "running")
      throw new ClientError("internal", "Stato del job non valido.");
    return false;
  }
  const stage = data?.stage;
  if (stage === "accepted" || stage === "failed" || stage === "cancelled")
    return true;
  // A review remake waits for its check job; it settles once none is active.
  if (stage === "review") return !data?.active_job;
  if (stage === "ingest" || stage === "analyse" || stage === "rewrite")
    return false;
  throw new ClientError("internal", "Stato del rifacimento non valido.");
}

export async function run(args: string[], io: CommandIO): Promise<void> {
  const { values, positionals } = parse(args);
  const [command = "", ...ids] = positionals;
  if (
    !Object.hasOwn(arity, command) ||
    values.url ||
    (values.watch && !watchable.includes(command)) ||
    ((values.lang !== undefined || values.country !== undefined) &&
      command !== "remake")
  )
    throw new ClientError(
      "validation",
      "Comando o opzioni non validi. Usa --help.",
    );
  if (ids.length !== arity[command] || ids.some((id) => !id))
    throw new ClientError("validation", "Identificatore mancante o inatteso.");
  const [first, second] = ids.map((id) => encodeURIComponent(id));
  const key = values["idempotency-key"];
  if (command === "tools") {
    const tools = await listTools(io.credentials);
    io.output({
      data: {
        tools: tools.map((tool) => ({
          name: tool.name,
          access: tool.write ? "write" : "read",
          description: tool.description ?? null,
        })),
      },
    });
    return;
  }
  if (command === "call") {
    const args = values.input ? await io.input(values.input) : {};
    io.output({
      data: await callTool(io.credentials, ids[0] ?? "", args, key),
    });
    return;
  }
  let path: string;
  let body: unknown;
  switch (command) {
    case "songs":
    case "costs":
    case "remakes":
      path = await query(`/${command}`, io, values.input);
      break;
    case "create":
      path = "/songs";
      body = await io.input(values.input);
      break;
    case "approve":
      path = `/songs/${first}/lyrics/approve`;
      body = await io.input(values.input);
      break;
    case "regenerate":
      path = `/songs/${first}/generate`;
      body = await io.input(values.input);
      break;
    case "video":
      path = `/songs/${first}/video`;
      body = {};
      break;
    case "pick":
      path = `/songs/${first}/takes/${second}/pick`;
      body = {};
      break;
    case "approve-video":
      path = `/songs/${first}/video/approve`;
      body = {};
      break;
    case "status":
      path = `/jobs/${first}`;
      break;
    case "remake":
      path = "/remakes";
      body = {
        url: ids[0],
        lang: values.lang ?? "it",
        ...(values.country === undefined ? {} : { country: values.country }),
      };
      break;
    case "remake-status":
      path = `/remakes/${first}`;
      break;
    case "remake-edit":
      path = `/remakes/${first}/lyrics`;
      body = await io.input(values.input);
      break;
    case "remake-accept":
      path = `/remakes/${first}/accept`;
      body = await io.input(values.input);
      break;
    case "remake-cancel":
      path = `/remakes/${first}/cancel`;
      body = {};
      break;
    case "remake-retry":
      path = `/remakes/${first}/retry`;
      body = {};
      break;
    // "Pubblica": plan, check, slot, ask; only the owner approves, in the app.
    case "publish-plan":
      path = "/publish/plans";
      body = {
        ...((values.input ? await io.input(values.input) : {}) as object),
        version_id: ids[0],
      };
      break;
    case "publish-status":
      path = `/songs/${first}/publish`;
      break;
    case "publish-preview":
      path = `/publish/${first}`;
      break;
    case "publish-edit":
      path = `/publish/${first}/draft`;
      body = { draft: await io.input(values.input) };
      break;
    case "publish-schedule":
      path = `/publish/${first}/schedule`;
      body = { slot_at: ids[1] };
      break;
    case "publish-request":
      path = `/publish/${first}/request-approval`;
      body = {};
      break;
    case "publish-veto":
      path = `/publish/${first}/veto`;
      body = {};
      break;
    case "publish-cancel":
      path = `/publish/${first}/cancel`;
      body = {};
      break;
    default:
      throw new ClientError("validation", "Usa il comando dalla CLI.");
  }
  for (;;) {
    const result = await request(io.credentials, path, body, key);
    io.output(result);
    if (!values.watch || settled(command, result)) return;
    await new Promise((resolve) => setTimeout(resolve, io.interval ?? 3000));
  }
}
