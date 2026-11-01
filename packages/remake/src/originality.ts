// Originality check of rewritten lyrics, line by line, against the source lyrics and
// (when the language changes) against a literal translation of them.
// Lexical: character trigram Dice, content-word containment and the longest run of
// shared words. Semantic: cosine of multilingual embeddings. A line above any
// threshold is flagged and gets rewritten.
import type { LineOriginality } from "./schemas.js";
import { baseLang, words } from "./syllables.js";

export type Thresholds = {
  lexical: number;
  semantic: number;
  sharedRun: number;
};
// Calibrated on the live run recorded in the task 24 report: a faithful re-expression of
// a line's idea scores 0.6-0.8 on bge-m3, a literal translation 0.9 or more.
export const DEFAULT_THRESHOLDS: Thresholds = {
  lexical: 0.6,
  semantic: 0.88,
  sharedRun: 4,
};

const STOPWORDS: Record<string, string[]> = {
  en: "a an the and or but i you he she it we they me my your our his her its their to of in on at by for with from into through up down out over is am are was were be been do does did have has had will would can could just so no not this that these those as if then there here oh".split(
    " ",
  ),
  it: "il lo la i gli le un uno una e ed o ma di a da in con su per tra fra che chi non mi ti si ci vi ne io tu lui lei noi voi loro mio mia tuo tua suo sua è sono sei siamo ho hai ha del della dei delle al alla ai nel nella sul come se poi qui là più".split(
    " ",
  ),
  es: "el la los las un una y o pero de a en con por para que no me te se nos mi tu su es son soy eres del al lo como si yo".split(
    " ",
  ),
  pt: "o a os as um uma e ou mas de em com por para que não me te se nos meu minha teu tua seu sua é são sou do da dos das no na eu".split(
    " ",
  ),
  fr: "le la les un une et ou mais de à en avec pour par que qui ne pas je tu il elle nous vous ils me te se mon ma mes ton ta son sa est suis es du des au aux".split(
    " ",
  ),
  de: "der die das ein eine und oder aber von zu in mit für auf an ich du er sie es wir ihr mich dich mein dein ist bin bist nicht den dem des im am".split(
    " ",
  ),
  ro: "și sau dar de la în cu pe pentru că nu eu tu el ea noi voi ei mă te se meu mea tău ta e este sunt un o al ale".split(
    " ",
  ),
};
const VOCABLES = new Set(
  "oh ooh ah eh uh yeah yeh hey ho na la da woah whoa wo mm mmm hmm ay ai oi ye uoh".split(
    " ",
  ),
);

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "");
}
function tokens(text: string): string[] {
  return words(fold(text));
}
function contentTokens(text: string, lang: string): string[] {
  const stop = new Set(
    (STOPWORDS[baseLang(lang)] ?? STOPWORDS.en ?? []).map((w) => fold(w)),
  );
  return tokens(text).filter((t) => !stop.has(t) && !VOCABLES.has(t));
}

export function isExempt(line: string, lang: string): boolean {
  return contentTokens(line, lang).length < 2;
}

function trigrams(text: string): string[] {
  const s = ` ${tokens(text).join(" ")} `;
  const grams: string[] = [];
  for (let i = 0; i + 3 <= s.length; i++) grams.push(s.slice(i, i + 3));
  return grams;
}

export function charTrigramDice(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  if (ga.length === 0 || gb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of gb) counts.set(g, (counts.get(g) ?? 0) + 1);
  let shared = 0;
  for (const g of ga) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(g, n - 1);
    }
  }
  return (2 * shared) / (ga.length + gb.length);
}

export function longestSharedRun(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  let best = 0;
  const row = new Array<number>(tb.length + 1).fill(0);
  for (let i = 1; i <= ta.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= tb.length; j++) {
      const above = row[j] ?? 0;
      row[j] = ta[i - 1] === tb[j - 1] ? diagonal + 1 : 0;
      best = Math.max(best, row[j] ?? 0);
      diagonal = above;
    }
  }
  return best;
}

export function scoreLexical(
  line: string,
  other: string,
  lang: string,
): { lexical: number; sharedRun: number } {
  const a = new Set(contentTokens(line, lang));
  const b = new Set(contentTokens(other, lang));
  const smaller = Math.min(a.size, b.size);
  const shared = [...a].filter((t) => b.has(t)).length;
  // Containment of one or two words says little; it counts from three content words.
  const containment = smaller >= 3 ? shared / smaller : 0;
  return {
    lexical:
      Math.round(Math.max(charTrigramDice(line, other), containment) * 1000) /
      1000,
    sharedRun: longestSharedRun(line, other),
  };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export type Embed = (texts: string[]) => Promise<number[][]>;

export type OriginalityReport = {
  lines: LineOriginality[];
  flaggedLines: number;
  maxLexical: number;
  maxSemantic: number;
  semanticAvailable: boolean;
  semanticError?: string;
  thresholds: Thresholds;
};

export async function checkOriginality(input: {
  lines: string[];
  sourceLines: string[];
  translationLines?: string[] | null;
  lang: string;
  sourceLang: string;
  thresholds?: Thresholds;
  embed?: Embed;
}): Promise<OriginalityReport> {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const references: {
    text: string;
    index: number;
    kind: "source" | "translation";
  }[] = [
    ...input.sourceLines.map((text, index) => ({
      text,
      index,
      kind: "source" as const,
    })),
    ...(input.translationLines ?? []).map((text, index) => ({
      text,
      index,
      kind: "translation" as const,
    })),
  ];

  let vectors: number[][] | null = null;
  let semanticError: string | undefined;
  if (input.embed && input.lines.length > 0 && references.length > 0) {
    try {
      const all = await input.embed([
        ...input.lines,
        ...references.map((r) => r.text),
      ]);
      if (all.length !== input.lines.length + references.length)
        throw new Error("embedding count mismatch");
      vectors = all;
    } catch (error) {
      semanticError = error instanceof Error ? error.message : String(error);
    }
  }

  const lines = input.lines.map((line, i): LineOriginality => {
    const exempt = isExempt(line, input.lang);
    let lexical = 0;
    let sharedRun = 0;
    let semantic: number | null = vectors ? 0 : null;
    let best = -1;
    let closestSource: number | null = null;
    let against: "source" | "translation" | null = null;
    references.forEach((ref, r) => {
      // Compare source-language text with the source's stopwords, new text with the target's.
      const lang = ref.kind === "source" ? input.sourceLang : input.lang;
      const lex = scoreLexical(line, ref.text, lang);
      const sem =
        vectors?.[i] && vectors[input.lines.length + r]
          ? Math.max(
              0,
              cosine(vectors[i] ?? [], vectors[input.lines.length + r] ?? []),
            )
          : 0;
      lexical = Math.max(lexical, lex.lexical);
      sharedRun = Math.max(sharedRun, lex.sharedRun);
      if (semantic !== null)
        semantic = Math.max(semantic, Math.round(sem * 1000) / 1000);
      const score = Math.max(
        lex.lexical,
        sem,
        lex.sharedRun >= thresholds.sharedRun ? 1 : 0,
      );
      if (score > best) {
        best = score;
        closestSource = ref.index;
        against = ref.kind;
      }
    });
    const flagged =
      !exempt &&
      (lexical >= thresholds.lexical ||
        sharedRun >= thresholds.sharedRun ||
        (semantic ?? 0) >= thresholds.semantic);
    return {
      lexical,
      semantic,
      sharedRun,
      closestSource,
      against,
      flagged,
      exempt,
    };
  });

  const scored = lines.filter((l) => !l.exempt);
  return {
    lines,
    flaggedLines: lines.filter((l) => l.flagged).length,
    maxLexical: Math.max(0, ...scored.map((l) => l.lexical)),
    maxSemantic: Math.max(0, ...scored.map((l) => l.semantic ?? 0)),
    semanticAvailable: vectors !== null,
    ...(semanticError ? { semanticError } : {}),
    thresholds,
  };
}
