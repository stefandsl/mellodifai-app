"use server";
import { headers } from "next/headers";
import { openRouterKey } from "@/lib/openrouter-key";
import { sessionCtx } from "@/lib/ops/context";
import { styleFormatCheck } from "@/lib/ops/defs/style-format-check";
import { runOp } from "@/lib/ops/run";
import { isRemote } from "@/lib/remote";
import {
  buildMessages,
  type Formatted,
  parseFormatReply,
} from "@/lib/studio/ai-format";
import { FormatStyleInput } from "./schemas";

export type FormatResult =
  | ({ ok: true } & Formatted)
  | { ok: false; error: "noKey" | "limit" | "failed" };

// The lyric pipeline's fast writer (worker: LYRICS_MODEL_FAST).
const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";

// "Formatta con AI": runs on the server because the OpenRouter key must never reach the browser.
// The key comes from the server environment or the worker's env files (lib/openrouter-key.ts).
export async function formatStyle(input: unknown): Promise<FormatResult> {
  if (isRemote(await headers())) return { ok: false, error: "failed" };
  try {
    const { styles } = FormatStyleInput.parse(input);
    const check = await runOp(styleFormatCheck, await sessionCtx(), {});
    if (!check.ok)
      return {
        ok: false,
        error: check.code === "rate_limited" ? "limit" : "failed",
      };
    const key = await openRouterKey();
    if (!key) return { ok: false, error: "noKey" };
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.LYRICS_MODEL_FAST || DEFAULT_MODEL,
          response_format: { type: "json_object" },
          messages: buildMessages(styles),
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      console.error("Style format request failed:", response.status);
      return { ok: false, error: "failed" };
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const parsed = parseFormatReply(body.choices?.[0]?.message?.content ?? "");
    return parsed ? { ok: true, ...parsed } : { ok: false, error: "failed" };
  } catch (error) {
    console.error(
      "Style format failed:",
      error instanceof Error ? error.name : "error",
    );
    return { ok: false, error: "failed" };
  }
}
