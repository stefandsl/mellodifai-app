import type { Clip } from "./clips";

// Lower case without accents, so "citta" finds "Città" and the other way round.
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function terms(query: string): string[] {
  return fold(query).split(/\s+/u).filter(Boolean);
}

// A song matches when every word of the query appears in its title, style, lyrics or prompt.
export function matchClip(clip: Clip, query: string): boolean {
  const words = terms(query);
  if (words.length === 0) return true;
  const haystack = fold(
    `${clip.title}\n${clip.style}\n${clip.prompt}\n${clip.lyrics}`,
  );
  return words.every((word) => haystack.includes(word));
}

// Songs that match, the ones whose title matches first, then the style, then the rest, each
// group keeping the order the list came in.
export function searchClips(clips: Clip[], query: string): Clip[] {
  const words = terms(query);
  if (words.length === 0) return [];
  const rank = (clip: Clip) => {
    const title = fold(clip.title);
    const style = fold(clip.style);
    if (words.every((word) => title.includes(word))) return 0;
    if (words.every((word) => `${title} ${style}`.includes(word))) return 1;
    return 2;
  };
  return clips
    .filter((clip) => matchClip(clip, query))
    .map((clip, order) => ({ clip, order, rank: rank(clip) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((item) => item.clip);
}

export function searchNames<T extends { name: string }>(
  items: T[],
  query: string,
): T[] {
  const words = terms(query);
  if (words.length === 0) return [];
  return items.filter((item) => {
    const name = fold(item.name);
    return words.every((word) => name.includes(word));
  });
}
