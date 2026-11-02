// Originality gate of rewritten lyrics (master design 10.3, binding values).
// Per new line, against each source line and its literal translation:
//   lexical: character 4-gram Jaccard and ROUGE-L, either above 0.35 fails the line;
//   semantic: LaBSE cosine above 0.80 against a translated source line fails the line.
// The new title and hook share no run of 3 or more words with the source title or hook
// (or their translation). Meaning fidelity is checked per section instead: each new
// section reaches cosine 0.55 against its meaning map, so a section can mean the same
// thing while each line is new.
import {
  type LineOriginality,
  ORIGINALITY_THRESHOLDS,
  type OriginalityThresholds,
} from "@mellodifai/shared";
import { words } from "./syllables.js";

export type Thresholds = OriginalityThresholds;
export const DEFAULT_THRESHOLDS: Thresholds = { ...ORIGINALITY_THRESHOLDS };

export type Embed = (texts: string[]) => Promise<number[][]>;

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "");
}
function tokens(text: string): string[] {
  return words(fold(text));
}

function grams(text: string, n: number): Set<string> {
  const s = ` ${tokens(text).join(" ")} `;
  const out = new Set<string>();
  for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
  return out;
}

export function jaccard4(a: string, b: string): number {
  const ga = grams(a, 4);
  const gb = grams(b, 4);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}

function lcs(a: string[], b: string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] ?? 0;
      row[j] =
        a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(above, row[j - 1] ?? 0);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

// ROUGE-L F1 on words.
export function rougeL(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const l = lcs(ta, tb);
  if (l === 0) return 0;
  const p = l / ta.length;
  const r = l / tb.length;
  return (2 * p * r) / (p + r);
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

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type LineReport = {
  lines: LineOriginality[];
  flaggedLines: number;
  maxLexical: number;
  maxSemantic: number;
};

export async function scoreLines(input: {
  lines: string[];
  sourceLines: string[];
  // Literal translation of each source line; null when the language does not change.
  translationLines: string[] | null;
  embed: Embed;
  thresholds?: Thresholds;
}): Promise<LineReport> {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const refs = [
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
  // Semantic reference: the translated source line (the source itself when the language stays).
  const semanticRefs = input.translationLines ?? input.sourceLines;
  const vectors = await input.embed([...input.lines, ...semanticRefs]);
  if (vectors.length !== input.lines.length + semanticRefs.length)
    throw new Error("embedding count mismatch");
  const lines = input.lines.map((line, i): LineOriginality => {
    let jac = 0;
    let rouge = 0;
    let best = -1;
    let closestSource: number | null = null;
    let against: "source" | "translation" | null = null;
    for (const ref of refs) {
      const j = jaccard4(line, ref.text);
      const r = rougeL(line, ref.text);
      jac = Math.max(jac, j);
      rouge = Math.max(rouge, r);
      if (Math.max(j, r) > best) {
        best = Math.max(j, r);
        closestSource = ref.index;
        against = ref.kind;
      }
    }
    let semantic = 0;
    let semanticAt = -1;
    semanticRefs.forEach((_, k) => {
      const c = Math.max(
        0,
        cosine(vectors[i] ?? [], vectors[input.lines.length + k] ?? []),
      );
      if (c > semantic) {
        semantic = c;
        semanticAt = k;
      }
    });
    const reasons: string[] = [];
    if (jac > t.lexical)
      reasons.push(`4-gram Jaccard ${r3(jac)} > ${t.lexical}`);
    if (rouge > t.lexical) reasons.push(`ROUGE-L ${r3(rouge)} > ${t.lexical}`);
    if (semantic > t.semantic) {
      reasons.push(`semantic ${r3(semantic)} > ${t.semantic}`);
      if (semantic > best) {
        closestSource = semanticAt;
        against = input.translationLines ? "translation" : "source";
      }
    }
    return {
      jaccard4: r3(jac),
      rougeL: r3(rouge),
      semantic: r3(semantic),
      closestSource,
      against,
      flagged: reasons.length > 0,
      reasons,
    };
  });
  return {
    lines,
    flaggedLines: lines.filter((l) => l.flagged).length,
    maxLexical: Math.max(
      0,
      ...lines.map((l) => Math.max(l.jaccard4, l.rougeL)),
    ),
    maxSemantic: Math.max(0, ...lines.map((l) => l.semantic ?? 0)),
  };
}

export function checkPhrases(input: {
  title: string;
  hookLines: string[];
  sourceTexts: string[];
  thresholds?: Thresholds;
}): { ok: boolean; longestRun: number; detail: string } {
  const limit = (input.thresholds ?? DEFAULT_THRESHOLDS).phraseWords;
  let longestRun = 0;
  let detail = "";
  for (const mine of [input.title, ...input.hookLines])
    for (const theirs of input.sourceTexts) {
      const run = longestSharedRun(mine, theirs);
      if (run > longestRun) {
        longestRun = run;
        detail =
          run >= limit
            ? `"${mine}" shares ${run} words in a row with "${theirs}"`
            : "";
      }
    }
  return { ok: longestRun < limit, longestRun, detail };
}

export async function checkSections(input: {
  sections: { sectionId: string; text: string; meaning: string }[];
  embed: Embed;
  thresholds?: Thresholds;
}): Promise<
  { sectionId: string; meaningCosine: number | null; ok: boolean }[]
> {
  const min = (input.thresholds ?? DEFAULT_THRESHOLDS).sectionMeaning;
  const usable = input.sections.filter(
    (s) => s.text.trim() && s.meaning.trim(),
  );
  const vectors = usable.length
    ? await input.embed([
        ...usable.map((s) => s.text),
        ...usable.map((s) => s.meaning),
      ])
    : [];
  return input.sections.map((s) => {
    const k = usable.indexOf(s);
    if (k < 0) return { sectionId: s.sectionId, meaningCosine: null, ok: true };
    const c = r3(
      Math.max(0, cosine(vectors[k] ?? [], vectors[usable.length + k] ?? [])),
    );
    return { sectionId: s.sectionId, meaningCosine: c, ok: c >= min };
  });
}
