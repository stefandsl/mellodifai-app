import type { TrackDetail } from "@/store/player";

// The first `count` comma-separated phrases of a style prompt.
export function stylePhrases(style: string, count: number): string[] {
  return style
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, count);
}

// Resolves the app's own relative links, like /media/...
const BASE = "http://app.invalid";

// A file name for the download: the title without characters Windows refuses, and the
// extension of the audio file itself (mp3 when it has none).
export function downloadName(title: string, audioUrl: string): string {
  const base = title
    .replace(/[/:*?"<>|]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100);
  let ext = "mp3";
  try {
    const found = /\.([a-z0-9]{2,4})$/iu.exec(new URL(audioUrl, BASE).pathname);
    if (found?.[1]) ext = found[1].toLowerCase();
  } catch {
    /* Not a URL: keep mp3. */
  }
  return `${base || "mellodifai"}.${ext}`;
}

// /media redirects to the storage service, on another origin, where the download attribute is
// ignored. The name travels in the download parameter, and storage sends an attachment under it.
export function downloadHref(audioUrl: string, name: string): string {
  if (!/^(https?:\/)?\//u.test(audioUrl)) return audioUrl;
  try {
    const url = new URL(audioUrl, BASE);
    url.searchParams.set("download", name);
    return url.origin === BASE
      ? `${url.pathname}${url.search}`
      : url.toString();
  } catch {
    return audioUrl;
  }
}

// The take number the listening view highlights: the preview being played, else the chosen
// take (the song's own audio), else the first one.
export function activeTake(
  detail: Pick<TrackDetail, "takes" | "chosenTakeId" | "takeNumber">,
): number | null {
  if (detail.takeNumber !== undefined) return detail.takeNumber;
  return (
    detail.takes.find((take) => take.id === detail.chosenTakeId)?.number ??
    detail.takes[0]?.number ??
    null
  );
}

export function speedLabel(speed: number): string {
  return `${speed}x`;
}
