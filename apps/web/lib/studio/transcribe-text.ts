// Whisper's segments as lyric lines: one line per segment, the same line said again kept (a
// chorus repeats), Whisper's filler for silence and music left out.
const FILLER =
  /^(?:\[[^\]]*\]|\([^)]*\)|♪+|music|musica|grazie(?: a tutti)?(?: per la visione)?\.?|thanks? for watching\.?|sottotitoli[^.]*\.?)$/iu;

export function segmentsToLyrics(segments: { text?: string }[]): string {
  const lines: string[] = [];
  for (const segment of segments) {
    const text = (segment.text ?? "").replace(/\s+/gu, " ").trim();
    if (!text || FILLER.test(text)) continue;
    lines.push(text);
  }
  return lines.join("\n").slice(0, 5000);
}
