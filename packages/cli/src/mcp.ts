import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { ClientError, idempotencyKey, responseError, send } from "./client.js";
import type { Credentials } from "./credentials.js";

const mutations = new Set([
  "song_create",
  "lyrics_approve",
  "lyrics_back",
  "song_generate_again",
  "take_pick",
  "video_make",
  "video_rerender",
  "video_approve",
  "stage_retry",
  "job_cancel",
  "stems_request",
  "visualizer_request",
]);

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

export async function bridge(
  input: Readable,
  output: Writable,
  credentials: Credentials,
): Promise<void> {
  let protocolVersion: string | undefined;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    let message: {
      jsonrpc: string;
      id?: string | number;
      method: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
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
      mutations.has(message.params?.name ?? "");
    let readingReply = false;
    try {
      if (
        message.method === "tools/call" &&
        message.params &&
        mutations.has(message.params.name ?? "")
      ) {
        const args = message.params.arguments ?? {};
        if (typeof args !== "object" || Array.isArray(args))
          throw new ClientError("validation", "Invalid arguments");
        message.params.arguments = {
          ...args,
          idempotency_key: idempotencyKey(args.idempotency_key),
        };
      }
      const response = await send(credentials, "/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(protocolVersion
            ? { "MCP-Protocol-Version": protocolVersion }
            : {}),
        },
        body: JSON.stringify(message),
      });
      if (!response.ok) throw await responseError(response);
      if (notification) continue;
      readingReply = true;
      const reply = await response.json();
      if (
        reply?.jsonrpc !== "2.0" ||
        reply.id !== message.id ||
        (!("result" in reply) && !("error" in reply))
      )
        throw new ClientError("internal", "Invalid JSON-RPC response");
      if (
        message.method === "initialize" &&
        typeof reply.result?.protocolVersion === "string"
      )
        protocolVersion = reply.result.protocolVersion;
      output.write(`${JSON.stringify(reply)}\n`);
    } catch (error) {
      if (notification) continue;
      const code =
        mutation && readingReply
          ? "ambiguous_spend"
          : error instanceof ClientError
            ? error.code
            : "internal";
      output.write(
        `${JSON.stringify(rpcError(message.id, -32000, code, { code }))}\n`,
      );
    }
  }
}
