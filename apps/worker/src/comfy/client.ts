import { writeFile } from "node:fs/promises";
import type { ComfyGraph } from "./graphs.js";

// The part of the WebSocket API the worker uses; Node 22's global WebSocket satisfies it.
export type SocketLike = {
  addEventListener(
    type: "message",
    listener: (event: { data?: unknown }) => void,
  ): void;
  addEventListener(
    type: "close" | "error",
    listener: (event: unknown) => void,
  ): void;
  close(): void;
};
export type Connect = (url: string) => SocketLike;

export type ComfyJob = {
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  execution_error?: { exception_message?: string; exception_type?: string };
};
export type ComfyFile = { filename: string; subfolder?: string; type?: string };
export type HistoryItem = {
  outputs?: Record<string, { audio?: ComfyFile[]; text?: unknown[] }>;
};

// ComfyUI refused the graph (400 with node_errors): a retry would be refused the same way.
export class GraphRejected extends Error {}

// The HTTP routes of yue2-integration.md section 2.4, nothing else.
export class ComfyClient {
  constructor(
    readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly connectImpl: Connect = (url) => new WebSocket(url),
  ) {}
  private async request(
    path: string,
    init: { method?: string; body?: unknown; timeoutMs?: number } = {},
  ): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init.method ?? "GET",
      ...(init.body === undefined
        ? {}
        : {
            body: JSON.stringify(init.body),
            headers: { "Content-Type": "application/json" },
          }),
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  }
  private async json<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const response = await this.request(path, init);
    if (!response.ok)
      throw new Error(`ComfyUI ${path} answered ${response.status}`);
    return (await response.json()) as T;
  }
  async hasNode(node: string): Promise<boolean> {
    const info = await this.json<Record<string, unknown>>(
      `/object_info/${encodeURIComponent(node)}`,
    );
    return node in info;
  }
  async submit(
    graph: ComfyGraph,
    promptId: string,
    clientId: string,
  ): Promise<void> {
    const response = await this.request("/prompt", {
      method: "POST",
      body: { prompt: graph, client_id: clientId, prompt_id: promptId },
    });
    if (response.status === 400)
      throw new GraphRejected(
        `ComfyUI rejected the graph: ${(await response.text()).slice(0, 2000)}`,
      );
    if (!response.ok)
      throw new Error(`ComfyUI /prompt answered ${response.status}`);
  }
  // null when the server does not know the id (never submitted, or lost with a restart).
  async job(promptId: string): Promise<ComfyJob | null> {
    const response = await this.request(`/api/jobs/${promptId}`);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`ComfyUI /api/jobs answered ${response.status}`);
    return (await response.json()) as ComfyJob;
  }
  async history(promptId: string): Promise<HistoryItem | null> {
    const all = await this.json<Record<string, HistoryItem>>(
      `/history/${promptId}`,
    );
    return all[promptId] ?? null;
  }
  async cancel(promptId: string): Promise<void> {
    await this.json(`/api/jobs/${promptId}/cancel`, { method: "POST" });
  }
  async download(file: ComfyFile, destination: string): Promise<void> {
    const query = new URLSearchParams({
      filename: file.filename,
      subfolder: file.subfolder ?? "",
      type: file.type ?? "output",
    });
    const response = await this.request(`/view?${query}`, {
      timeoutMs: 300_000,
    });
    if (!response.ok)
      throw new Error(`ComfyUI /view answered ${response.status}`);
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  }
  async logs(): Promise<string[]> {
    const raw = await this.json<{ entries?: { m?: string }[] }>(
      "/internal/logs/raw",
    );
    return (raw.entries ?? []).map((entry) => entry.m ?? "");
  }
  connect(clientId: string): SocketLike {
    return this.connectImpl(
      `${this.baseUrl.replace(/^http/u, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`,
    );
  }
}
