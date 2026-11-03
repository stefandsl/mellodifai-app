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

const isSunoPage = (url: URL) =>
  url.protocol === "https:" &&
  !url.port &&
  !url.username &&
  !url.password &&
  ["suno.com", "www.suno.com", "app.suno.ai"].includes(url.hostname);

async function fetchAllowed(
  url: URL,
  allowed: (url: URL) => boolean,
  headers: HeadersInit,
  signal: AbortSignal,
): Promise<{ response: Response; url: URL } | null> {
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!allowed(url)) return null;
    const response = await fetch(url, { headers, redirect: "manual", signal });
    if (response.status < 300 || response.status >= 400)
      return { response, url };
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) return null;
    url = new URL(location, url);
  }
  return null;
}

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
  let pageResult: Awaited<ReturnType<typeof fetchAllowed>>;
  try {
    pageResult = await fetchAllowed(
      link,
      isSunoPage,
      HEADERS,
      AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    );
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
  if (!pageResult?.response.ok)
    return NextResponse.json({ error: "page" }, { status: 502 });
  const html = await readLimited(pageResult.response, PAGE_LIMIT);
  if (!html) return NextResponse.json({ error: "page" }, { status: 502 });
  const song = readSunoPage(
    new TextDecoder().decode(html),
    pageResult.url.href,
  );
  if (!song.audio || !isSunoAudio(song.audio))
    return NextResponse.json({ error: "no audio" }, { status: 422 });
  let audioResult: Awaited<ReturnType<typeof fetchAllowed>>;
  try {
    audioResult = await fetchAllowed(
      new URL(song.audio),
      (url) => isSunoAudio(url.href),
      { "User-Agent": HEADERS["User-Agent"] },
      AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    );
  } catch {
    return NextResponse.json({ error: "audio" }, { status: 502 });
  }
  const bytes = audioResult?.response.ok
    ? await readLimited(audioResult.response, AUDIO_UPLOAD_LIMIT)
    : null;
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
