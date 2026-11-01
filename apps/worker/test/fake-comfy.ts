import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { SocketLike } from "../src/comfy/client.js";

// A ComfyUI 0.43.0 stand-in with the routes the worker uses (yue2-integration.md 2.4). Tests
// script each prompt with onSubmit and push WebSocket messages with emit().
export type FakePrompt = {
  graph: Record<string, { inputs: Record<string, unknown> }>;
  clientId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  outputs?: Record<string, unknown>;
  error?: string;
};

class FakeSocket implements SocketLike {
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  closed = false;
  constructor(
    readonly clientId: string,
    private readonly onClose: (socket: FakeSocket) => void,
  ) {}
  addEventListener(type: string, listener: (event: never) => void) {
    this.listeners.set(type, [
      ...(this.listeners.get(type) ?? []),
      listener as (event: unknown) => void,
    ]);
  }
  dispatch(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onClose(this);
    this.dispatch("close", {});
  }
}

async function body(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) text += String(chunk);
  return text ? JSON.parse(text) : null;
}

export async function fakeComfy() {
  const state = {
    up: true,
    version: "0.43.0",
    nodes: new Set<string>([
      "YuE2GenerateABC",
      "YuE2GenerateMusic",
      "EmptyYuE2LatentAudio",
      "SaveAudioAdvanced",
      "TextEncodeAceStepAudio1.5",
      "EmptyAceStep1.5LatentAudio",
      "ModelSamplingAuraFlow",
    ]),
    prompts: new Map<string, FakePrompt>(),
    submitted: [] as string[],
    cancelled: [] as string[],
    freed: 0,
    logs: [] as string[],
    rejectNext: false,
    requests: [] as string[],
  };
  const sockets = new Set<FakeSocket>();
  let onSubmit: (id: string, prompt: FakePrompt) => void = () => {};
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://fake");
      const path = url.pathname;
      state.requests.push(`${request.method} ${path}`);
      const json = (value: unknown, status = 200) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (!state.up) return json({ error: "starting" }, 503);
      if (path === "/system_stats")
        return json({ system: { comfyui_version: state.version } });
      if (path.startsWith("/object_info/")) {
        const node = decodeURIComponent(path.slice("/object_info/".length));
        return json(state.nodes.has(node) ? { [node]: { name: node } } : {});
      }
      if (path === "/prompt" && request.method === "POST") {
        const payload = (await body(request)) as {
          prompt: FakePrompt["graph"];
          client_id: string;
          prompt_id: string;
        };
        if (state.rejectNext) {
          state.rejectNext = false;
          return json(
            {
              error: { type: "prompt_outputs_failed_validation" },
              node_errors: { "25": {} },
            },
            400,
          );
        }
        const prompt: FakePrompt = {
          graph: payload.prompt,
          clientId: payload.client_id,
          status: "pending",
        };
        state.prompts.set(payload.prompt_id, prompt);
        state.submitted.push(payload.prompt_id);
        json({ prompt_id: payload.prompt_id, number: 1, node_errors: {} });
        setImmediate(() => onSubmit(payload.prompt_id, prompt));
        return;
      }
      const job = /^\/api\/jobs\/([^/]+)(\/cancel)?$/u.exec(path);
      if (job?.[1]) {
        const prompt = state.prompts.get(job[1]);
        if (job[2]) {
          state.cancelled.push(job[1]);
          if (prompt && ["pending", "in_progress"].includes(prompt.status))
            prompt.status = "cancelled";
          return json({ cancelled: Boolean(prompt) });
        }
        if (!prompt) return json({ error: "Job not found" }, 404);
        return json({
          id: job[1],
          status: prompt.status,
          ...(prompt.error
            ? { execution_error: { exception_message: prompt.error } }
            : {}),
        });
      }
      const history = /^\/history\/([^/]+)$/u.exec(path);
      if (history?.[1]) {
        const prompt = state.prompts.get(history[1]);
        if (prompt?.status !== "completed") return json({});
        return json({
          [history[1]]: {
            outputs: prompt.outputs ?? {},
            status: { status_str: "success", completed: true, messages: [] },
          },
        });
      }
      if (path === "/view") {
        response.writeHead(200, { "Content-Type": "audio/flac" });
        response.end(`FLAC ${url.searchParams.get("filename")}`);
        return;
      }
      if (path === "/internal/logs/raw")
        return json({ entries: state.logs.map((m) => ({ m })) });
      if (path === "/free" && request.method === "POST") {
        state.freed += 1;
        return json({});
      }
      json({ error: "not found" }, 404);
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    state,
    port,
    url: `http://127.0.0.1:${port}`,
    sockets,
    onSubmit(handler: (id: string, prompt: FakePrompt) => void) {
      onSubmit = handler;
    },
    connect(url: string): SocketLike {
      const clientId = new URL(url).searchParams.get("clientId") ?? "";
      const socket = new FakeSocket(clientId, (closed) =>
        sockets.delete(closed),
      );
      sockets.add(socket);
      return socket;
    },
    // ComfyUI sends execution messages only to the socket of the client that queued the prompt.
    emit(promptId: string, type: string, data: Record<string, unknown>) {
      const prompt = state.prompts.get(promptId);
      for (const socket of sockets)
        if (socket.clientId === prompt?.clientId)
          socket.dispatch("message", {
            data: JSON.stringify({
              type,
              data: { ...data, prompt_id: promptId },
            }),
          });
    },
    // Runs a prompt to the end the way the real server reports it.
    finish(promptId: string, outputs: Record<string, unknown>) {
      const prompt = state.prompts.get(promptId);
      if (!prompt) throw new Error(`unknown prompt ${promptId}`);
      prompt.status = "completed";
      prompt.outputs = outputs;
      this.emit(promptId, "execution_success", {});
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
export type FakeComfy = Awaited<ReturnType<typeof fakeComfy>>;
