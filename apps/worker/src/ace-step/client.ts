// Minimal client for ACE-Step 1.5's own REST API (docs/en/API.md in the official
// repository): POST /release_task, POST /query_result, GET /v1/audio?path=.
export type AceStepTask = {
  prompt: string;
  lyrics: string;
  audioDuration: number;
  seed: number;
  vocalLanguage: string;
  inferenceSteps?: number;
  thinking?: boolean;
};
export type AceStepResult =
  | { state: "running" }
  | { state: "failed"; error: string }
  | { state: "done"; file: string; seed?: string }
  | { state: "unknown" };

type Envelope<T> = { data?: T; code?: number; error?: unknown };

export class AceStepClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly http: typeof fetch = fetch,
  ) {}
  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.http(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`ACE-Step ${path} HTTP ${response.status}`);
    const envelope = (await response.json()) as Envelope<T>;
    if (envelope.error || envelope.data === undefined)
      throw new Error(
        `ACE-Step ${path} error: ${String(envelope.error ?? "no data")}`,
      );
    return envelope.data;
  }
  async release(task: AceStepTask): Promise<string> {
    const data = await this.post<{ task_id?: string }>("/release_task", {
      prompt: task.prompt,
      lyrics: task.lyrics,
      audio_duration: task.audioDuration,
      seed: task.seed,
      use_random_seed: false,
      batch_size: 1,
      audio_format: "wav",
      vocal_language: task.vocalLanguage,
      inference_steps: task.inferenceSteps ?? 8,
      thinking: task.thinking ?? true,
    });
    if (!data.task_id)
      throw new Error("ACE-Step release_task returned no task_id");
    return data.task_id;
  }
  async query(taskId: string): Promise<AceStepResult> {
    const data = await this.post<
      { task_id: string; status: number; result?: string | unknown[] }[]
    >("/query_result", { task_id_list: [taskId] });
    const row = data.find((item) => item.task_id === taskId);
    if (!row) return { state: "unknown" };
    if (row.status === 0) return { state: "running" };
    if (row.status === 2)
      return {
        state: "failed",
        error: typeof row.result === "string" ? row.result : "failed",
      };
    const results = (
      typeof row.result === "string"
        ? JSON.parse(row.result)
        : (row.result ?? [])
    ) as { file?: string; seed_value?: string }[];
    const first = results.find((item) => item.file);
    if (!first?.file)
      return { state: "failed", error: "no audio file in result" };
    return {
      state: "done",
      file: first.file,
      ...(first.seed_value ? { seed: first.seed_value } : {}),
    };
  }
  // `file` is the server's own "/v1/audio?path=..." link from the result.
  async download(file: string): Promise<Uint8Array> {
    const url = file.startsWith("/") ? `${this.baseUrl}${file}` : file;
    if (!url.startsWith(`${this.baseUrl}/`))
      throw new Error(
        "ACE-Step returned an audio link outside the local server",
      );
    const response = await this.http(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`ACE-Step audio HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
