import type { TrackDetail } from "@/store/player";

// The first `count` comma-separated phrases of a style prompt.
export function stylePhrases(style: string, count: number): string[] {
  return style
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, count);
}

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
    const found = /\.([a-z0-9]{2,4})$/iu.exec(new URL(audioUrl).pathname);
    if (found?.[1]) ext = found[1].toLowerCase();
  } catch {
    /* A relative URL: keep mp3. */
  }
  return `${base || "mellodifai"}.${ext}`;
}

// The audio lives on another origin, where the download attribute is ignored. The storage
// service sends a file as an attachment under the name given in its download parameter.
export function downloadHref(audioUrl: string, name: string): string {
  try {
    const url = new URL(audioUrl);
    url.searchParams.set("download", name);
    return url.toString();
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
