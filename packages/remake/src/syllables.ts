// Sung-syllable counts and line endings, per language, without a dictionary.
// A count is a range: `min` merges every vowel across a word boundary (synalepha, as
// singers do in Italian, Spanish, Portuguese and Romanian) and every ambiguous vowel
// pair; `max` splits them. The range is what a melody line can carry.
import type { Ending } from "./schemas.js";

export type Syllables = { min: number; max: number };

const STRONG = new Set([..."aeoàèéòóáâãêôõăâ"]);
const ACCENTED_WEAK = new Set([..."ìíùú"]);
const WEAK = new Set([..."iuüîï"]);
const LATIN_VOWELS: Record<string, string> = {
  it: "aeiouàèéìíòóùú",
  es: "aeiouáéíóúü",
  pt: "aeiouáéíóúâêôãõàü",
  ro: "aeiouăâî",
  fr: "aeiouyàâéèêëîïôûùüœæ",
  de: "aeiouyäöü",
  en: "aeiouy",
};
const DEFAULT_VOWELS = "aeiouyàáâãäåæèéêëìíîïòóôõöùúûüÿăœ";
const ROMANCE = new Set(["it", "es", "pt", "ro"]);
const CYRILLIC_VOWELS = new Set([..."аеёиоуыэюяіїє"]);
const SMALL_KANA = new Set([..."ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ"]);
const KANA = /[぀-ヿ]/u;
const HAN = /[㐀-鿿豈-﫿]/u;
const HANGUL = /[가-힯]/u;

export function baseLang(lang: string): string {
  return lang.toLowerCase().split(/[-_]/u)[0] ?? lang;
}

// Words as sung units: elided apostrophes join ("un'onda" is one sung word).
export function words(line: string): string[] {
  return line
    .toLowerCase()
    .replace(/['’`]/gu, "")
    .split(/[^\p{L}\p{M}]+/u)
    .filter(Boolean);
}

function vowelGroups(word: string, vowels: string): string[] {
  const groups: string[] = [];
  let current = "";
  for (const [i, ch] of [...word].entries()) {
    // English "y" before a vowel at the start of a word is a consonant ("you").
    const isVowel =
      vowels.includes(ch) &&
      !(ch === "y" && i === 0 && vowels.includes(word[1] ?? ""));
    if (isVowel) current += ch;
    else if (current) {
      groups.push(current);
      current = "";
    }
  }
  if (current) groups.push(current);
  return groups;
}

// Romance nucleus splitting: two strong vowels are a hiatus, an accented i/u breaks a
// diphthong, and an i/u between two vowels starts the next syllable ("a-iuo-la").
function romanceNuclei(group: string): number {
  const g = [...group];
  let count = 1;
  for (let k = 1; k < g.length; k++) {
    const a = g[k - 1] ?? "";
    const b = g[k] ?? "";
    const nextIsVowel = k + 1 < g.length;
    if (
      (STRONG.has(a) && STRONG.has(b)) ||
      ACCENTED_WEAK.has(a) ||
      ACCENTED_WEAK.has(b) ||
      (WEAK.has(b) && nextIsVowel && STRONG.has(a))
    )
      count++;
  }
  return count;
}

function romanceWord(word: string, vowels: string): Syllables {
  const groups = vowelGroups(word, vowels);
  const n = groups.reduce((sum, g) => sum + romanceNuclei(g), 0);
  // Word-final weak vowel plus vowel ("mio", "via", "zio") is sung either way.
  const last = groups.at(-1) ?? "";
  const ambiguous =
    n <= 2 &&
    last.length === 2 &&
    WEAK.has(last[0] ?? "") &&
    !WEAK.has(last[1] ?? "") &&
    new RegExp(`${last}$`, "u").test(word)
      ? 1
      : 0;
  return { min: n, max: n + ambiguous };
}

function englishWord(word: string): number {
  const groups = vowelGroups(word, LATIN_VOWELS.en ?? "");
  let n = groups.length;
  if (n > 1) {
    const last = groups.at(-1);
    const silentE =
      last === "e" &&
      word.endsWith("e") &&
      !/[^aeiouy]le$/u.test(word) &&
      !/^(?:the|me|he|she|we|be)$/u.test(word);
    const silentEd = /[^td]ed$/u.test(word) && last === "e";
    const silentEs =
      /[^aeiouy]es$/u.test(word) &&
      !/(?:[sxz]|ch|sh|ge|ce)es$/u.test(word) &&
      last === "e";
    if (silentE || silentEd || silentEs) n--;
  }
  return Math.max(1, n);
}

function frenchWord(word: string): Syllables {
  const groups = vowelGroups(word, LATIN_VOWELS.fr ?? "");
  const n = groups.length;
  // A final mute e (e, es, ent) is silent in speech, sung in many melodies.
  const mute = n > 1 && /(?:[^aeiouy]e|[^aeiouy]es|[^aeiouy]ent)$/u.test(word);
  return { min: Math.max(1, mute ? n - 1 : n), max: Math.max(1, n) };
}

function wordSyllables(word: string, lang: string): Syllables {
  if (HANGUL.test(word)) {
    const n = [...word].filter((c) => HANGUL.test(c)).length;
    return { min: n, max: n };
  }
  if (KANA.test(word) || (lang === "ja" && HAN.test(word))) {
    let min = 0;
    let max = 0;
    for (const c of word) {
      if (KANA.test(c) && !SMALL_KANA.has(c)) {
        min++;
        max++;
      } else if (HAN.test(c)) {
        // Kanji readings are one or two morae in most lyrics.
        min += 1;
        max += 2;
      }
    }
    return { min, max };
  }
  if (HAN.test(word)) {
    const n = [...word].filter((c) => HAN.test(c)).length;
    return { min: n, max: n };
  }
  if ([...word].some((c) => CYRILLIC_VOWELS.has(c) || /[а-я]/u.test(c))) {
    const n = Math.max(1, [...word].filter((c) => CYRILLIC_VOWELS.has(c)).length);
    return { min: n, max: n };
  }
  if (lang === "en") {
    const n = englishWord(word);
    return { min: n, max: n };
  }
  if (lang === "fr") return frenchWord(word);
  const vowels = LATIN_VOWELS[lang] ?? DEFAULT_VOWELS;
  if (ROMANCE.has(lang)) return romanceWord(word, vowels);
  const n = Math.max(1, vowelGroups(word, vowels).length);
  return { min: n, max: n };
}

const startsWithVowel = (word: string, lang: string) => {
  const vowels = LATIN_VOWELS[lang] ?? DEFAULT_VOWELS;
  const first = word.startsWith("h") && lang !== "ro" ? word[1] : word[0];
  return vowels.includes(first ?? "");
};
const endsWithVowel = (word: string, lang: string) =>
  (LATIN_VOWELS[lang] ?? DEFAULT_VOWELS).includes(word.at(-1) ?? "");

export function countSyllables(line: string, lang: string): Syllables {
  const l = baseLang(lang);
  const list = words(line);
  let min = 0;
  let max = 0;
  for (const w of list) {
    const s = wordSyllables(w, l);
    min += s.min;
    max += s.max;
  }
  if (ROMANCE.has(l))
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1] ?? "";
      const b = list[i] ?? "";
      if (endsWithVowel(a, l) && startsWithVowel(b, l)) min--;
    }
  return { min: Math.max(0, Math.min(min, max)), max };
}

const ACCENTED = /[àèéìíòóùúáâêôãõ]/u;

export function lineEnding(line: string, lang: string): Ending {
  const l = baseLang(lang);
  const last = words(line).at(-1);
  if (!last) return "unknown";
  if (KANA.test(last) || HAN.test(last) || HANGUL.test(last)) return "unknown";
  const syllables = wordSyllables(last, l);
  if (syllables.max <= 1) return "stressed";
  switch (l) {
    case "it":
      if (ACCENTED.test(last.at(-1) ?? "")) return "stressed";
      return /[aeiou]$/u.test(last) ? "unstressed" : "stressed";
    case "es":
    case "pt": {
      const accent = [...last].findLastIndex((c) => ACCENTED.test(c));
      if (accent >= 0) {
        const after = last.slice(accent + 1);
        return /[aeiou]/u.test(after) ? "unstressed" : "stressed";
      }
      if (l === "es") return /[aeiouns]$/u.test(last) ? "unstressed" : "stressed";
      return /(?:[aeo]|[aeo]s|am|em|ens)$/u.test(last) ? "unstressed" : "stressed";
    }
    case "fr":
      return /(?:e|es|ent)$/u.test(last) ? "unstressed" : "stressed";
    case "en":
      return /(?:ing|y|er|ly|le|ness|ful|less|ow|en|on|ed|es|a|o)$/u.test(last)
        ? "unstressed"
        : "unknown";
    case "de":
      return /(?:e|en|er|el|ung|chen|lein)$/u.test(last)
        ? "unstressed"
        : "unknown";
    default:
      return "unknown";
  }
}

export type Fit = { fits: boolean; endingMatch: boolean; delta: number };

// A candidate fits when its syllable range lands within tolerance of the target's.
// An unstressed final syllable can share the last note of a stressed target ending.
export function fitLine(
  target: Syllables & { ending: Ending },
  candidate: Syllables & { ending: Ending },
): Fit {
  const known = target.ending !== "unknown" && candidate.ending !== "unknown";
  const endingMatch = !known || target.ending === candidate.ending;
  const shift =
    known && target.ending === "stressed" && candidate.ending === "unstressed"
      ? 1
      : 0;
  const cMin = candidate.min - shift;
  const cMax = candidate.max - shift;
  const delta =
    cMin > target.max ? cMin - target.max : cMax < target.min ? cMax - target.min : 0;
  const tolerance = Math.max(1, Math.round(0.12 * ((target.min + target.max) / 2)));
  return { fits: Math.abs(delta) <= tolerance, endingMatch, delta };
}

export function singingRate(s: Syllables, start: number, end: number): number {
  const duration = end - start;
  return duration > 0 ? (s.min + s.max) / 2 / duration : 0;
}
