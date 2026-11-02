"use server";
// "Scrivi con AI", "Rigenera" and "Migliora" (task 27): one lyrics_assist job of the worker's lyric
// pipeline per click (migration 20261102000025). The editor polls lyrics_assist_state.
import { LyricsAssistInputSchema } from "@mellodifai/shared";
import { z } from "zod";
import { actionProfile } from "@/lib/auth";

export type LyricsAssistError = "busy" | "limit" | "invalid" | "failed";
export type LyricsAssistActionResult =
  | { ok: true; id: string }
  | { ok: false; error: LyricsAssistError };

export async function requestLyricsAssist(
  input: unknown,
): Promise<LyricsAssistActionResult> {
  const parsed = LyricsAssistInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { mode, lang, ...rest } = parsed.data;
  try {
    const { supabase } = await actionProfile();
    const { data, error } = await supabase.rpc("lyrics_assist_request", {
      p_mode: mode,
      p_lang: lang,
      p_input: rest,
    });
    if (error) {
      if (/already running/u.test(error.message))
        return { ok: false, error: "busy" };
      if (/daily lyrics limit/u.test(error.message))
        return { ok: false, error: "limit" };
      console.error("Lyrics request failed:", error.message.slice(0, 300));
      return { ok: false, error: "failed" };
    }
    return { ok: true, id: data as string };
  } catch (error) {
    console.error(
      "Lyrics request failed:",
      error instanceof Error ? error.name : "error",
    );
    return { ok: false, error: "failed" };
  }
}

export async function cancelLyricsAssist(input: unknown) {
  const id = z.string().uuid().safeParse(input);
  if (!id.success) return { ok: false as const };
  try {
    const { supabase } = await actionProfile();
    const { error } = await supabase.rpc("lyrics_assist_cancel", {
      p_request: id.data,
    });
    return { ok: !error };
  } catch {
    return { ok: false as const };
  }
}
