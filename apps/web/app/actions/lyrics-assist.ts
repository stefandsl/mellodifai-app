"use server";
// "Scrivi con AI", "Rigenera" and "Migliora" (task 27): one lyrics_assist job of the worker's lyric
// pipeline per click (migration 20261102000026). The editor polls lyrics_assist_state.
import { LyricsAssistInputSchema } from "@mellodifai/shared";
import { headers } from "next/headers";
import { z } from "zod";
import { callOps } from "@/lib/db/ops-client";
import { sessionCtx } from "@/lib/ops/context";
import { lyricsAssistCancel } from "@/lib/ops/defs/lyrics-assist-cancel";
import { lyricsAssistRequest } from "@/lib/ops/defs/lyrics-assist-request";
import { runOp } from "@/lib/ops/run";
import { isRemote } from "@/lib/remote";

export type LyricsAssistError = "busy" | "limit" | "invalid" | "failed";
export type LyricsAssistActionResult =
  | { ok: true; id: string }
  | { ok: true; committed: true }
  | { ok: false; error: LyricsAssistError; idempotencyKey?: string };

export async function readLyricsAssistState(input: string) {
  if (isRemote(await headers()))
    return {
      ok: false as const,
      code: "unauthorized" as const,
      message: "Local access required",
    };
  const id = z.string().uuid().safeParse(input);
  if (!id.success)
    return {
      ok: false as const,
      code: "validation" as const,
      message: "Invalid request",
    };
  try {
    return await callOps<unknown>("lyrics_assist_state", [
      await sessionCtx(),
      id.data,
    ]);
  } catch {
    return {
      ok: false as const,
      code: "unauthorized" as const,
      message: "Session required",
    };
  }
}

export async function requestLyricsAssist(
  input: unknown,
): Promise<LyricsAssistActionResult> {
  if (isRemote(await headers())) return { ok: false, error: "failed" };
  const parsed = LyricsAssistInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { mode, lang, ...rest } = parsed.data;
  try {
    const result = await runOp(lyricsAssistRequest, await sessionCtx(), {
      p_mode: mode,
      p_lang: lang,
      p_input: rest,
    });
    if (!result.ok) {
      const reason = z
        .object({ action_error: z.string() })
        .safeParse(result.details);
      return {
        ok: false,
        error:
          reason.success &&
          (reason.data.action_error === "busy" ||
            reason.data.action_error === "limit")
            ? reason.data.action_error
            : "failed",
        ...(result.idempotency_key
          ? { idempotencyKey: result.idempotency_key }
          : {}),
      };
    }
    return "committed" in result
      ? { ok: true, committed: true }
      : { ok: true, id: result.data.id };
  } catch (error) {
    console.error(
      "Lyrics request failed:",
      error instanceof Error ? error.name : "error",
    );
    return { ok: false, error: "failed" };
  }
}

export async function cancelLyricsAssist(input: unknown) {
  if (isRemote(await headers())) return { ok: false as const };
  const id = z.string().uuid().safeParse(input);
  if (!id.success) return { ok: false as const };
  try {
    const result = await runOp(lyricsAssistCancel, await sessionCtx(), {
      p_request: id.data,
    });
    return { ok: result.ok };
  } catch {
    return { ok: false as const };
  }
}
