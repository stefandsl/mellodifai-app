import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// kie.ai's jobs API for the endpoints the worker calls directly (the plain generation still goes
// through suno-remake/tools/kie.mjs): replace-section, upload-and-cover-audio and
// upload-and-extend-audio (docs.kie.ai/suno-api/*, checked 2026-11-01), the credit balance and
// the free file upload that gives kie a URL for audio on this PC (files are deleted after 24 h).
export const KIE_API = "https://api.kie.ai";
export const KIE_UPLOAD_API = "https://kieai.redpandaai.co";

// kie answered and did not take the task: nothing was charged.
export class KieRefused extends Error {}
// The task ran and failed on kie's side.
export class KieFailed extends Error {}

export type KieTrack = {
  id?: string;
  url: string;
  duration?: number;
  title?: string;
  image?: string;
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The record layout differs between kie products: every object that carries an audio URL is a
// track (a port of kie.mjs findTracks), once per URL.
export function findTracks(node: unknown, found: KieTrack[] = []): KieTrack[] {
  if (Array.isArray(node)) {
    for (const item of node) findTracks(item, found);
  } else if (node && typeof node === "object") {
    const item = node as Record<string, unknown>;
    const url =
      item.audioUrl ??
      item.audio_url ??
      item.sourceAudioUrl ??
      item.source_audio_url;
    if (typeof url === "string" && url.startsWith("http")) {
      const id = item.id ?? item.audioId ?? item.audio_id;
      const image = item.image_url ?? item.imageUrl;
      found.push({
        url,
        ...(typeof id === "string" ? { id } : {}),
        ...(typeof item.duration === "number"
          ? { duration: item.duration }
          : {}),
        ...(typeof item.title === "string" ? { title: item.title } : {}),
        ...(typeof image === "string" ? { image } : {}),
      });
    }
    for (const value of Object.values(item))
      findTracks(
        typeof value === "string" && value.startsWith("{")
          ? safeJson(value)
          : value,
        found,
      );
  }
  return found.filter(
    (track, i, all) => all.findIndex((other) => other.url === track.url) === i,
  );
}

type Envelope = { code: number; msg?: string; data?: unknown };

export class KieClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => delay(ms),
  ) {
    if (!apiKey) throw new KieRefused("KIE_API_KEY is not set on this worker");
  }
  private async call(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
  ): Promise<Envelope> {
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    const parsed = safeJson(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("kie response unreadable");
    const raw = parsed as Record<string, unknown>;
    const code =
      typeof raw.code === "number"
        ? raw.code
        : typeof raw.code === "string" && /^\d{3}$/u.test(raw.code)
          ? Number(raw.code)
          : Number.NaN;
    if (!Number.isInteger(code) || code < 100 || code > 599)
      throw new Error("kie response unreadable");
    const json = { ...raw, code } as Envelope;
    if (!response.ok || code !== 200) {
      const message = `kie ${new URL(url).pathname} answered ${response.status}/${code}: ${String(json.msg ?? "").slice(0, 200)}`;
      if (
        (response.ok || (response.status >= 400 && response.status < 500)) &&
        code >= 400 &&
        code < 500
      )
        throw new KieRefused(message);
      throw new Error(message);
    }
    return json;
  }
  async credits(): Promise<number> {
    const result = await this.call("GET", `${KIE_API}/api/v1/chat/credit`);
    const value = Number(result.data);
    if (!Number.isFinite(value)) throw new Error("kie balance unreadable");
    return value;
  }
  // A validated kie client error code throws KieRefused. Anything
  // else that goes wrong after the request left (a timeout, a dropped connection) is unknown and
  // throws a plain Error, so the caller never submits twice.
  async createTask(body: { model: string; input: Record<string, unknown> }) {
    let result: Envelope;
    try {
      result = await this.call(
        "POST",
        `${KIE_API}/api/v1/jobs/createTask`,
        body,
      );
    } catch (error) {
      if (error instanceof KieRefused) throw error;
      throw new Error("kie submission state unknown, check the kie dashboard");
    }
    const taskId = (result.data as { taskId?: unknown } | undefined)?.taskId;
    if (typeof taskId !== "string" || !taskId)
      throw new Error("kie submission state unknown, check the kie dashboard");
    return taskId;
  }
  async record(taskId: string): Promise<{ state: string; data: unknown }> {
    const result = await this.call(
      "GET",
      `${KIE_API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    );
    const data = (result.data ?? {}) as { state?: unknown; status?: unknown };
    return { state: String(data.state ?? data.status ?? "unknown"), data };
  }
  // Polls a task until it succeeds (its tracks) or fails (KieFailed); a timeout is an Error
  // the job can retry for free, since the task id is kept.
  async wait(
    taskId: string,
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      pollMs?: number;
      onState?: (state: string) => void;
    } = {},
  ): Promise<{ tracks: KieTrack[]; data: unknown }> {
    const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
    let last = "";
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted();
      const { state, data } = await this.record(taskId);
      if (state !== last) {
        last = state;
        options.onState?.(state);
      }
      if (/success/iu.test(state)) return { tracks: findTracks(data), data };
      if (/fail|error/iu.test(state))
        throw new KieFailed(
          `kie task failed: ${JSON.stringify(data).slice(0, 300)}`,
        );
      await this.sleep(options.pollMs ?? 10_000);
    }
    throw new Error("kie task still pending: Retry checks again for free");
  }
  // Free upload of a local file; returns the URL kie can read for 24 hours.
  async upload(file: string, contentType: string): Promise<string> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([await readFile(file)], { type: contentType }),
      basename(file),
    );
    form.append("uploadPath", "mellodifai");
    form.append("fileName", basename(file));
    const response = await this.fetchImpl(
      `${KIE_UPLOAD_API}/api/file-stream-upload`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(300_000),
      },
    );
    const json = (safeJson(await response.text()) ?? {}) as Envelope;
    const url = (json.data as { downloadUrl?: unknown } | undefined)
      ?.downloadUrl;
    if (!response.ok || typeof url !== "string" || !url.startsWith("http"))
      throw new Error(
        `kie upload failed (${response.status}/${json.code ?? "-"}): ${String(json.msg ?? "").slice(0, 200)}`,
      );
    return url;
  }
  async download(url: string, file: string, signal?: AbortSignal) {
    const response = await this.fetchImpl(url, {
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`kie audio download ${response.status}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
}
