import { AUDIO_UPLOAD_LIMIT, UPLOADS_BUCKET } from "@mellodifai/shared";
import { type NextRequest, NextResponse } from "next/server";

import { isSunoAudio, readSunoPage, sunoLink } from "@/lib/studio/suno-link";
import { createClient } from "@/lib/supabase/server";

const PAGE_LIMIT = 4 * 1024 * 1024;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; MellodifAI song import; one request per click)",
  Accept: "text/html,application/xhtml+xml",
};

async function readLimited(
  response: Response,
  limit: number,
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

// "Importa da Suno" from a share link, at the owner's click: one request for the song's public
// page and one for its MP3, which goes into the owner's uploads folder like a dropped file.
export async function POST(request: NextRequest) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
  } | null;
  const link = typeof body?.url === "string" ? sunoLink(body.url) : null;
  if (!link)
    return NextResponse.json({ error: "not a suno link" }, { status: 400 });
  let page: Response;
  try {
    page = await fetch(link, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
  const final = new URL(page.url || link.href);
  // A redirect may only land on Suno itself.
  if (!page.ok || !/(?:^|\.)suno\.(?:com|ai)$/u.test(final.hostname))
    return NextResponse.json({ error: "page" }, { status: 502 });
  const html = await readLimited(page, PAGE_LIMIT);
  if (!html) return NextResponse.json({ error: "page" }, { status: 502 });
  const song = readSunoPage(new TextDecoder().decode(html), final.href);
  if (!song.audio || !isSunoAudio(song.audio))
    return NextResponse.json({ error: "no audio" }, { status: 422 });
  let audio: Response;
  try {
    audio = await fetch(song.audio, {
      headers: { "User-Agent": HEADERS["User-Agent"] },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    });
  } catch {
    return NextResponse.json({ error: "audio" }, { status: 502 });
  }
  const bytes = audio.ok ? await readLimited(audio, AUDIO_UPLOAD_LIMIT) : null;
  if (!bytes) return NextResponse.json({ error: "audio" }, { status: 502 });
  const path = `${user.id}/audio/${crypto.randomUUID()}.mp3`;
  const { error } = await db.storage
    .from(UPLOADS_BUCKET)
    .upload(path, new Blob([bytes as BlobPart], { type: "audio/mpeg" }), {
      contentType: "audio/mpeg",
      upsert: false,
    });
  if (error) return NextResponse.json({ error: "storage" }, { status: 502 });
  return NextResponse.json({
    path,
    size: bytes.byteLength,
    title: song.title,
    author: song.author,
    style: song.style,
    lyrics: song.lyrics,
    image: song.image,
    url: link.href,
  });
}
