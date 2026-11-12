// "Importa da Suno" with a pasted share link. suno.com's terms forbid robots and scraping, so
// nothing here browses or automates the site: at the owner's click the route makes one plain
// request for that song's public page and one for its audio file, as a browser would.

const PAGE_HOSTS = new Set(["suno.com", "www.suno.com", "app.suno.ai"]);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u;

// The link as typed, if it is a suno.com song or share link.
export function sunoLink(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !PAGE_HOSTS.has(url.hostname)
  )
    return null;
  if (/^\/s\/[A-Za-z0-9]{4,40}\/?$/u.test(url.pathname)) return url;
  if (/^\/song\/[0-9a-f-]{36}\/?$/u.test(url.pathname)) return url;
  return null;
}

// Only Suno's own audio hosts are fetched.
export function isSunoAudio(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      /^cdn\d*\.suno\.ai$/u.test(url.hostname) &&
      /\.mp3$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;|&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function meta(html: string, name: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name.replace(/[.]/gu, "\\$&")}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name.replace(/[.]/gu, "\\$&")}["']`,
    "iu",
  );
  const match = pattern.exec(html);
  const value = match?.[1] ?? match?.[2];
  return value ? decodeEntities(value) : null;
}

// A JSON string field from the page's embedded data. The streamed payload often holds the data as
// a JSON string inside a script, so the page is also read with one level of quotes unescaped.
function embedded(html: string, field: string): string | null {
  for (const text of [html, html.replace(/\\"/gu, '"')]) {
    const match = new RegExp(`"${field}":"((?:[^"\\\\]|\\\\.)*)"`, "u").exec(
      text,
    );
    if (!match?.[1]) continue;
    let value = match[1];
    for (let i = 0; i < 3; i++) {
      try {
        const next = JSON.parse(`"${value}"`) as string;
        if (next === value) break;
        value = next;
      } catch {
        break;
      }
    }
    return value.trim() || null;
  }
  return null;
}

export type SunoSong = {
  id: string | null;
  title: string | null;
  audio: string | null;
  image: string | null;
  style: string | null;
  lyrics: string | null;
  author: string | null;
};

// What the public page tells about the song: its audio, title, artwork and, when the page
// carries them, the style tags and the lyrics.
export function readSunoPage(html: string, finalUrl: string): SunoSong {
  const id =
    UUID.exec(finalUrl)?.[0] ??
    UUID.exec(meta(html, "og:audio") ?? "")?.[0] ??
    null;
  const audio =
    [
      meta(html, "og:audio"),
      meta(html, "og:audio:url"),
      meta(html, "twitter:player:stream"),
    ]
      .filter((value): value is string => Boolean(value))
      .find(isSunoAudio) ?? (id ? `https://cdn1.suno.ai/${id}.mp3` : null);
  const ogTitle = meta(html, "og:title");
  // "Song title by Artist | Suno" or "Song title | Suno".
  const byMatch = ogTitle
    ? /^(.*?)(?: by (.+?))?(?: \| Suno)?$/u.exec(ogTitle)
    : null;
  return {
    id,
    title: byMatch?.[1]?.trim() || null,
    author: byMatch?.[2]?.trim() || embedded(html, "display_name"),
    audio,
    image: meta(html, "og:image"),
    style: embedded(html, "tags"),
    lyrics: embedded(html, "prompt"),
  };
}
