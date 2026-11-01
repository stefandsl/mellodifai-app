// Stored media is linked through /media, which signs a short-lived storage link on each request.
// A signed link written into the page expires after an hour; a page left open, or a track queued
// before then, would point at a link the storage refuses.
export function mediaUrl(path: string): string {
  return `/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}
