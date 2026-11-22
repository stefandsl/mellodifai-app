// Clean-room judge: our visible strings against the text captured from the reference site.
// Two rules:
// 1. No run of `minWords` or more words (default 6) that also stands in a reference string.
// 2. No whole string of ours equal to a whole reference string, unless it is an interface word
//    on the allow list (short words every site uses, such as "Menu").
// The captured text never enters the repo: the CLI reads it from the research folder.

export type CleanRoomHit = { ours: string; reference: string; match: string };

export type CleanRoomResult = {
  pass: boolean;
  sharedRuns: CleanRoomHit[];
  equalStrings: CleanRoomHit[];
  checkedStrings: number;
};

/** Lower case words, letters and digits only; typographic apostrophes count as plain ones. */
export function wordsOf(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replaceAll(/[‘’ʼ]/gu, "'")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? []
  );
}

const key = (text: string) => wordsOf(text).join(" ");

export function cleanRoom(input: {
  ours: string[];
  reference: string[];
  allow?: string[];
  minWords?: number;
}): CleanRoomResult {
  const n = input.minWords ?? 6;
  const allow = new Set((input.allow ?? []).map(key));
  const runs = new Map<string, string>();
  const whole = new Map<string, string>();
  for (const ref of input.reference) {
    const w = wordsOf(ref);
    if (!w.length) continue;
    if (!whole.has(w.join(" "))) whole.set(w.join(" "), ref);
    for (let i = 0; i + n <= w.length; i++) {
      const run = w.slice(i, i + n).join(" ");
      if (!runs.has(run)) runs.set(run, ref);
    }
  }
  const sharedRuns: CleanRoomHit[] = [];
  const equalStrings: CleanRoomHit[] = [];
  const seen = new Set<string>();
  for (const ours of input.ours) {
    const w = wordsOf(ours);
    const k = w.join(" ");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const same = whole.get(k);
    if (same !== undefined && !allow.has(k)) equalStrings.push({ ours, reference: same, match: k });
    for (let i = 0; i + n <= w.length; i++) {
      const run = w.slice(i, i + n).join(" ");
      const ref = runs.get(run);
      if (ref !== undefined) {
        sharedRuns.push({ ours, reference: ref, match: run });
        break;
      }
    }
  }
  return {
    pass: sharedRuns.length === 0 && equalStrings.length === 0,
    sharedRuns,
    equalStrings,
    checkedStrings: seen.size,
  };
}
