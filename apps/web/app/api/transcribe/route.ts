import { LANGS } from "@mellodifai/shared";
import { type NextRequest, NextResponse } from "next/server";

import { groqKey } from "@/lib/openrouter-key";
import { segmentsToLyrics } from "@/lib/studio/transcribe-text";
import { createClient } from "@/lib/supabase/server";

// Groq's Whisper, the model the worker's take scoring uses (suno-remake tools/whisper_words.py).
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3";
// Groq's free-tier file cap; the studio sends a 16 kHz mono WAV, about 2 MB a minute.
const MAX_BYTES = 25 * 1024 * 1024;

// Transcribes a recording into lyrics for the lyrics box (the create panel, "Importa da Suno").
// The browser cancels with an AbortController; the request's signal stops the call to Groq too.
export async function POST(request: NextRequest) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !["admin", "customer"].includes(String(profile.role)))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const lang = String(form?.get("lang") ?? "");
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "too big" }, { status: 413 });
  const key = await groqKey();
  if (!key) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const body = new FormData();
  body.append("file", file, "audio.wav");
  body.append("model", MODEL);
  body.append("response_format", "verbose_json");
  body.append("timestamp_granularities[]", "segment");
  body.append("timestamp_granularities[]", "word");
  if ((LANGS as readonly string[]).includes(lang))
    body.append("language", lang);
  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]),
    });
  } catch {
    return NextResponse.json({ error: "cancelled" }, { status: 499 });
  }
  if (!response.ok) {
    console.error("Transcription failed:", response.status);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
  const result = (await response.json()) as {
    segments?: { text?: string }[];
    words?: { word?: string; start?: number; end?: number }[];
  };
  return NextResponse.json({
    lyrics: segmentsToLyrics(result.segments ?? []),
    words: (result.words ?? []).flatMap((item) =>
      typeof item.word === "string" &&
      typeof item.start === "number" &&
      typeof item.end === "number"
        ? [{ word: item.word, start: item.start, end: item.end }]
        : [],
    ),
  });
}
