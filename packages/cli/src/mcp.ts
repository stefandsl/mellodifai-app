import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { OPS_ERROR_CODES, type OpsErrorCode } from "@mellodifai/shared";
import { ClientError, idempotencyKey, responseError, send } from "./client.js";
import type { Credentials } from "./credentials.js";

type RpcMessage = {
  jsonrpc: string;
  id?: string | number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> } & Record<
    string,
    unknown
  >;
};
type RpcReply = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
};
export type ToolInfo = {
  name: string;
  write: boolean;
  description: string | undefined;
};

const LIST_ID = "mellodifai-cli-tools-list";
const CALL_ID = "mellodifai-cli-tools-call";
const MAX_LIST_PAGES = 20;

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/** One JSON-RPC message to /api/mcp with the PAT; throws on an HTTP failure. */
export async function postRpc(
  credentials: Credentials,
  message: unknown,
  protocolVersion?: string,
): Promise<Response> {
  const response = await send(credentials, "/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
    },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw await responseError(response);
  return response;
}

/** Reads a JSON-RPC reply and checks it answers the request with this id. */
export async function readReply(
  response: Response,
  id: string | number,
): Promise<RpcReply> {
  const reply = await response.json();
  if (
    reply?.jsonrpc !== "2.0" ||
    reply.id !== id ||
    (!("result" in reply) && !("error" in reply))
  )
    throw new ClientError("internal", "Invalid JSON-RPC response");
  return reply;
}

function toolInfos(result: unknown): ToolInfo[] | undefined {
  const tools = (result as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) return undefined;
  return tools.flatMap((tool) =>
    tool && typeof tool.name === "string"
      ? [
          {
            name: tool.name,
            // MCP defaults readOnlyHint to false, so only an explicit true is a read.
            write: tool.annotations?.readOnlyHint !== true,
            description:
              typeof tool.description === "string"
                ? tool.description
                : undefined,
          },
        ]
      : [],
  );
}

/** Every tool the server lists, following nextCursor. */
export async function listTools(
  credentials: Credentials,
  protocolVersion?: string,
): Promise<ToolInfo[]> {
  const tools: ToolInfo[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    let reply: RpcReply;
    try {
      reply = await readReply(
        await postRpc(
          credentials,
          {
            jsonrpc: "2.0",
            id: LIST_ID,
            method: "tools/list",
            params: cursor ? { cursor } : {},
          },
          protocolVersion,
        ),
        LIST_ID,
      );
    } catch (error) {
      // A list is a read: a lost reply never means ambiguous spend.
      throw error instanceof ClientError && error.code !== "ambiguous_spend"
        ? error
        : new ClientError(
            "internal",
            "Elenco degli strumenti non disponibile.",
          );
    }
    const infos = toolInfos(reply.result);
    if (reply.error || !infos)
      throw new ClientError("internal", "Elenco degli strumenti non valido.");
    tools.push(...infos);
    const next = reply.result?.nextCursor;
    if (typeof next !== "string" || !next) return tools;
    cursor = next;
  }
  throw new ClientError("internal", "Elenco degli strumenti non valido.");
}

/**
 * Which tools write, learned from tools/list annotations. Until a list is known it is
 * fetched once; a tool that is unknown, or every tool when no list is available, is a write.
 */
export class ToolKinds {
  private kinds = new Map<string, boolean>();
  private known = false;
  private fetched = false;

  /** Records the tools of a tools/list result that passed through the bridge. */
  record(result: unknown): void {
    const infos = toolInfos(result);
    if (infos) this.learn(infos);
  }

  private learn(infos: ToolInfo[]): void {
    for (const info of infos) this.kinds.set(info.name, info.write);
    this.known = true;
  }

  async isWrite(
    name: string,
    fetchList: () => Promise<ToolInfo[]>,
  ): Promise<boolean> {
    if (!this.known && !this.fetched) {
      this.fetched = true;
      try {
        this.learn(await fetchList());
      } catch {
        // No list: every call stays a write.
      }
    }
    return this.kinds.get(name) ?? true;
  }
}

function withKey(
  args: unknown,
  key?: string,
): Record<string, unknown> & { idempotency_key: string } {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new ClientError("validation", "Invalid arguments");
  const record = args as Record<string, unknown>;
  if (
    key !== undefined &&
    record.idempotency_key !== undefined &&
    record.idempotency_key !== key
  )
    throw new ClientError(
      "validation",
      "La chiave di idempotenza differisce da quella nell'input.",
    );
  return {
    ...record,
    idempotency_key: idempotencyKey(key ?? record.idempotency_key),
  };
}

function errorCode(value: unknown): OpsErrorCode | undefined {
  return OPS_ERROR_CODES.includes(value as OpsErrorCode)
    ? (value as OpsErrorCode)
    : undefined;
}

/** One tools/call for the CLI; returns structuredContent or throws the tool's error. */
export async function callTool(
  credentials: Credentials,
  name: string,
  args: unknown,
  key?: string,
): Promise<unknown> {
  const write = await new ToolKinds().isWrite(name, () =>
    listTools(credentials),
  );
  let input = args;
  if (write) input = withKey(args, key);
  else if (!args || typeof args !== "object" || Array.isArray(args))
    throw new ClientError("validation", "Invalid arguments");
  const response = await postRpc(credentials, {
    jsonrpc: "2.0",
    id: CALL_ID,
    method: "tools/call",
    params: { name, arguments: input },
  }).catch((error: unknown) => {
    if (
      !write &&
      error instanceof ClientError &&
      error.code === "ambiguous_spend"
    )
      throw new ClientError("internal", error.message);
    throw error;
  });
  let reply: RpcReply;
  try {
    reply = await readReply(response, CALL_ID);
  } catch {
    throw new ClientError(
      write ? "ambiguous_spend" : "internal",
      "Risposta non valida. Verifica lo stato prima di riprovare.",
    );
  }
  if (reply.error) {
    const data = reply.error.data as { code?: unknown } | undefined;
    const code =
      errorCode(data?.code) ??
      (reply.error.code === -32602 || reply.error.code === -32601
        ? "validation"
        : "internal");
    throw new ClientError(code, code);
  }
  const result = reply.result ?? {};
  if (result.isError === true) {
    const error = (
      result.structuredContent as
        | { error?: Record<string, unknown> }
        | undefined
    )?.error;
    const code = errorCode(error?.code) ?? "internal";
    throw new ClientError(
      code,
      code,
      typeof error?.retry_after === "number" ? error.retry_after : undefined,
    );
  }
  if (!result.structuredContent || typeof result.structuredContent !== "object")
    throw new ClientError(
      write ? "ambiguous_spend" : "internal",
      "Risposta non valida. Verifica lo stato prima di riprovare.",
    );
  return result.structuredContent;
}

export async function bridge(
  input: Readable,
  output: Writable,
  credentials: Credentials,
): Promise<void> {
  let protocolVersion: string | undefined;
  const kinds = new ToolKinds();
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    let message: RpcMessage;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(
        `${JSON.stringify(rpcError(null, -32700, "Parse error"))}\n`,
      );
      continue;
    }
    if (
      !message ||
      Array.isArray(message) ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" ||
      ("id" in message &&
        typeof message.id !== "string" &&
        typeof message.id !== "number")
    ) {
      output.write(
        `${JSON.stringify(rpcError(null, -32600, "Invalid Request"))}\n`,
      );
      continue;
    }
    const notification = !("id" in message);
    const mutation =
      message.method === "tools/call" &&
      (await kinds.isWrite(
        typeof message.params?.name === "string" ? message.params.name : "",
        () => listTools(credentials, protocolVersion),
      ));
    let readingReply = false;
    try {
      if (mutation && message.params)
        message.params.arguments = withKey(message.params.arguments ?? {});
      const response = await postRpc(credentials, message, protocolVersion);
      if (notification) continue;
      readingReply = true;
      const reply = await readReply(response, message.id as string | number);
      if (
        message.method === "initialize" &&
        typeof reply.result?.protocolVersion === "string"
      )
        protocolVersion = reply.result.protocolVersion;
      if (message.method === "tools/list") kinds.record(reply.result);
      output.write(`${JSON.stringify(reply)}\n`);
    } catch (error) {
      if (notification) continue;
      let code = error instanceof ClientError ? error.code : "internal";
      if (mutation && readingReply) code = "ambiguous_spend";
      else if (!mutation && code === "ambiguous_spend") code = "internal";
      output.write(
        `${JSON.stringify(rpcError(message.id, -32000, code, { code }))}\n`,
      );
    }
  }
}
