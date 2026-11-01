import {
  BPM_RANGE,
  SONG_KEYS,
  TIME_SIGNATURES,
  type TimeSignature,
} from "@mellodifai/shared";

// "Formatta con AI": the fast writer of the lyric pipeline rewrites the styles field as a music
// prompt and proposes the three musical parameters. Pure pieces live here; the call itself runs
// on the server (app/actions/format-style.ts) because the OpenRouter key must never reach the
// browser.
export const FORMAT_FIELDS = ["style", "bpm", "key", "timeSignature"] as const;

export type Formatted = {
  styles: string;
  bpm?: number;
  keyscale?: string;
  timeSignature?: TimeSignature;
};

const SYSTEM = `You rewrite the "style of music" field of an AI song generator.
Input: the person's rough description of the music (any language).
Return JSON only, with these fields:
- "style": a concise music prompt of comma-separated English tags (genre, mood, instruments, vocal character, production), at most 400 characters. Keep every idea the person wrote. Never name real artists. Never use the long dash character.
- "bpm": the typical tempo for that style as an integer between ${BPM_RANGE.min} and ${BPM_RANGE.max}, or null when unsure.
- "key": a musical key such as "A minor" or "Eb major", or null when unsure.
- "timeSignature": one of "2/4", "3/4", "4/4", "6/8", or null when unsure.`;

export function buildMessages(styles: string) {
  return [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: styles },
  ];
}

const FLAT_OR_SHARP: Record<string, string> = {
  b: "b",
  flat: "b",
  "#": "#",
  sharp: "#",
};

// "E-flat major", "f sharp minor", "Bb major" -> the spelling ACE-Step accepts, else null.
export function normalizeKey(text: string): string | null {
  const match = /^([A-G])(?:[\s-]?(sharp|flat|#|b))?\s+(major|minor)$/iu.exec(
    text.trim(),
  );
  if (!match?.[1] || !match[3]) return null;
  const key = `${match[1].toUpperCase()}${FLAT_OR_SHARP[(match[2] ?? "").toLowerCase()] ?? ""} ${match[3].toLowerCase()}`;
  return (SONG_KEYS as readonly string[]).includes(key) ? key : null;
}

const SIGNATURES: Record<string, TimeSignature> = {
  "2/4": "2",
  "3/4": "3",
  "4/4": "4",
  "6/8": "6",
};
const REDACTED =
  /\[(?:PERSON_NAME|ADDRESS|EMAIL(?:_ADDRESS)?|PHONE(?:_NUMBER)?|LOCATION|ORGANIZATION|DATE_TIME|URL|IP_ADDRESS)\]/u;
const STYLE_LIMIT = 1000;

// The model's reply as usable data: a style that fits the form, and each parameter only when it
// is one the engines accept. Null when there is no usable style at all.
export function parseFormatReply(text: string): Formatted | null {
  let value: unknown;
  try {
    value = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/iu, "")
        .replace(/\s*```$/u, ""),
    );
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const reply = value as Record<string, unknown>;
  if (typeof reply.style !== "string") return null;
  const styles = reply.style
    .replaceAll(String.fromCodePoint(0x2014), "-")
    .trim()
    .slice(0, STYLE_LIMIT)
    .trim();
  if (!styles || REDACTED.test(styles)) return null;
  const result: Formatted = { styles };
  if (typeof reply.bpm === "number" && Number.isFinite(reply.bpm)) {
    const bpm = Math.round(reply.bpm);
    if (bpm >= BPM_RANGE.min && bpm <= BPM_RANGE.max) result.bpm = bpm;
  }
  if (typeof reply.key === "string") {
    const keyscale = normalizeKey(reply.key);
    if (keyscale) result.keyscale = keyscale;
  }
  if (typeof reply.timeSignature === "string") {
    const signature = SIGNATURES[reply.timeSignature.trim()];
    if (signature && (TIME_SIGNATURES as readonly string[]).includes(signature))
      result.timeSignature = signature;
  }
  return result;
}
