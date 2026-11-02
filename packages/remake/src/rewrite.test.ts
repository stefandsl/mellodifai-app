import { describe, expect, it } from "vitest";
import { createClient, DEFAULT_MODELS, RedactionError } from "./openrouter.js";
import type { Embed } from "./originality.js";
import {
  checkLyrics,
  reviewUser,
  rewrite,
  rewriteSection,
  songTitle,
} from "./rewrite.js";
import {
  analysisFixture,
  chatReply,
  type FakeCall,
  fakeFetch,
} from "./test-fixtures.js";

const SOURCE = [
  "I walk alone through the empty streets",
  "Hold on to the light tonight",
];
const LITERAL = [
  "Cammino da solo per le strade vuote",
  "Tieniti alla luce stanotte",
];
const GOOD = [
  "giro la notte su un tram che non va",
  "la luce resta qui con me",
];
const PASS = {
  language: 0.9,
  singable: 0.9,
  chorus: 0.85,
  original: 0.9,
  meaning_fidelity: 0.85,
  timing_fit: 0.9,
  youtube_safety: 0.95,
};
const FAIL = { ...PASS, singable: 0.4 };

// Source and translation lines get orthogonal vectors; new lyrics and meaning maps share
// one direction, so sections match their meaning and no line matches a source line.
function fakeEmbed(meaningMatch = true): Embed {
  const refs = new Map<string, number>();
  return async (texts) =>
    texts.map((t) => {
      const v = new Array(64).fill(0);
      if ([...SOURCE, ...LITERAL].includes(t)) {
        if (!refs.has(t)) refs.set(t, refs.size + 1);
        v[refs.get(t) ?? 1] = 1;
      } else if (meaningMatch || !GOOD.includes(t)) v[0] = 1;
      else v[63] = 1;
      return v;
    });
}

function role(call: FakeCall): string {
  const messages = call.body.messages as { content: string }[] | undefined;
  if (call.url.endsWith("/alpha/decisions")) return "jev";
  return (
    /ROLE: ([a-z' ]+)/u.exec(messages?.[0]?.content ?? "")?.[1]?.trim() ?? "?"
  );
}

type Script = {
  draft?: (n: number) => string[];
  jury?: (round: number) => typeof PASS;
  issues?: (round: number) => unknown[];
  objections?: (round: number) => unknown[];
  writerText?: string;
  judgesDown?: boolean;
  redactJudge?: boolean;
  redactDevil?: (n: number) => boolean;
  cost?: number;
  // The final pass's reply: new text per line index (default: the lines unchanged).
  finisher?: (asked: string) => { index: number; text: string }[];
  // Judges that score "original" by the overlap between the block they are told to score and
  // the source song, like a model that takes whatever it reads as lyrics for the new lyrics.
  literalJudges?: boolean;
};

function grams4(text: string): Set<string> {
  const s = ` ${text.toLowerCase().replace(/[^\p{L}\s]/gu, "")} `;
  const out = new Set<string>();
  for (let i = 0; i + 4 <= s.length; i++) out.add(s.slice(i, i + 4));
  return out;
}
// 1 when no line of the judged text shares wording with a source line, lower the more it does.
function literalScore(judged: string): number {
  let worst = 0;
  for (const line of judged.split("\n"))
    for (const source of SOURCE) {
      const a = grams4(line);
      const b = grams4(source);
      let shared = 0;
      for (const g of a) if (b.has(g)) shared++;
      const union = a.size + b.size - shared;
      worst = Math.max(worst, union ? shared / union : 0);
    }
  return Math.round((1 - Math.min(1, worst * 1.6)) * 100) / 100;
}
function newLyricsBlock(user: string): string {
  const start = user.indexOf("=== NEW LYRICS (score these) ===");
  const end = user.indexOf("=== END OF NEW LYRICS ===");
  return start >= 0 && end > start ? user.slice(start, end) : user;
}

function scripted(script: Script = {}) {
  const counts = { writer: 0, judge: 0, devil: 0, fixer: 0, finisher: 0 };
  const round = () => counts.devil + 1;
  const { fetchFn, calls } = fakeFetch((call) => {
    const r = role(call);
    const cost = script.cost ?? 0.001;
    if (script.judgesDown && (r === "jev" || r === "judge of remake lyrics"))
      return { status: 500, text: "down" };
    switch (r) {
      case "jev": {
        const scores = { ...(script.jury?.(round()) ?? PASS) };
        if (script.literalJudges) {
          const state = call.body.state as Record<string, string>;
          scores.original = literalScore(
            state.new_lyrics ?? state.lyrics_review ?? JSON.stringify(state),
          );
        }
        return {
          answers: Object.fromEntries(
            Object.entries(scores).map(([k, v]) => [k, { noul: v }]),
          ),
        };
      }
      case "literal translator":
        return chatReply({ lines: LITERAL }, cost);
      case "lyric writer for a remake": {
        counts.writer++;
        if (script.writerText) return chatReply(script.writerText, cost);
        const lines = script.draft?.(counts.writer) ?? [LITERAL[0], GOOD[1]];
        return chatReply(
          {
            title: "Tram di notte",
            sections: [
              { id: "verse-1", lines: [lines[0]] },
              { id: "chorus-1", lines: [lines[1]] },
            ],
          },
          cost,
        );
      }
      case "lyric line fixer": {
        counts.fixer++;
        const asked = String(
          (call.body.messages as { content: string }[])[1]?.content ?? "",
        );
        const fixed = GOOD.flatMap((text, index) =>
          asked.includes(`\n${index}. "`) ? [{ index, text }] : [],
        );
        return chatReply({ title: null, lines: fixed }, cost);
      }
      case "lyric finisher": {
        counts.finisher++;
        const asked = String(
          (call.body.messages as { content: string }[])[1]?.content ?? "",
        );
        return chatReply(
          { title: null, lines: script.finisher?.(asked) ?? [] },
          cost,
        );
      }
      case "judge of remake lyrics":
        counts.judge++;
        if (script.literalJudges) {
          const user = String(
            (call.body.messages as { content: string }[])[1]?.content ?? "",
          );
          return chatReply(
            {
              scores: { ...PASS, original: literalScore(newLyricsBlock(user)) },
              issues: [],
            },
            cost,
          );
        }
        if (script.redactJudge)
          return chatReply(
            { scores: PASS, issues: ["line 1 mentions [PERSON_NAME]"] },
            cost,
          );
        return chatReply(
          {
            scores: script.jury?.(round()) ?? PASS,
            issues: script.issues?.(round()) ?? [],
          },
          cost,
        );
      case "devil's advocate":
        counts.devil++;
        if (script.redactDevil?.(counts.devil))
          return chatReply(
            {
              objections: [
                {
                  category: "other",
                  severity: "note",
                  line: null,
                  text: "[PERSON_NAME] is odd",
                },
              ],
            },
            cost,
          );
        return chatReply(
          {
            objections: script.objections?.(counts.devil) ?? [
              {
                category: "other",
                severity: "note",
                line: null,
                text: "the title is plain",
              },
            ],
          },
          cost,
        );
      default:
        throw new Error(`unexpected call ${r}`);
    }
  });
  return {
    client: createClient({ key: "k", fetchFn, retries: 0 }),
    calls,
    counts,
  };
}

const deps = (
  client: ReturnType<typeof scripted>["client"],
  meaningMatch = true,
) => ({
  client,
  embed: fakeEmbed(meaningMatch),
  embedder: "fake",
});

describe("rewrite", () => {
  it("fixes a literally translated line, passes the jury and logs the cost", async () => {
    const { client, counts } = scripted();
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    expect(counts.fixer).toBe(1);
    expect(result.jury).toMatchObject({
      passed: true,
      stoppedBecause: "passed",
    });
    expect(result.jury.rounds).toHaveLength(1);
    expect(result.jury.rounds[0]?.devil.objections[0]?.text).toBe(
      "the title is plain",
    );
    expect(result.originality).toMatchObject({
      flaggedLines: 0,
      embedder: "fake",
      phrase: { ok: true },
    });
    expect(result.originality.sections.every((s) => s.ok)).toBe(true);
    const lines = result.sections.flatMap((s) => s.lines);
    expect(lines.map((l) => l.text)).toEqual(GOOD);
    expect(lines.every((l) => l.fits)).toBe(true);
    expect(result.lyricsText).toBe(
      "[Intro]\n\n[Verse 1]\ngiro la notte su un tram che non va\n\n[Chorus 1]\nla luce resta qui con me",
    );
    expect(result.cost.usd).toBeGreaterThan(0);
    expect(result.cost.calls.map((c) => c.step)).toEqual(
      expect.arrayContaining([
        "translate-literal",
        "write",
        "fix-lines",
        "jury:devil",
      ]),
    );
    expect(result.styleTags).not.toContain("night song");
  });

  it("rewrites only the lines the jury names, keeping the others", async () => {
    const { client, counts } = scripted({
      draft: () => ["giro tutta la notte su un tram", GOOD[1] ?? ""],
      jury: (r) => (r === 1 ? FAIL : PASS),
      issues: (r) => (r === 1 ? [{ line: 0, problem: "line 0 limps" }] : []),
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    expect(counts.writer).toBe(1);
    expect(result.jury.rounds.map((r) => r.passed)).toEqual([false, true]);
    expect(result.jury.rounds[0]?.failing).toEqual(["singable"]);
    expect(result.sections.flatMap((s) => s.lines).map((l) => l.text)).toEqual(
      GOOD,
    );
  });

  it("revises the whole draft when the jury's notes name no line", async () => {
    const { client, counts } = scripted({
      draft: () => GOOD,
      jury: (r) => (r === 1 ? FAIL : PASS),
      issues: (r) => (r === 1 ? ["it feels flat"] : []),
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    expect(counts.writer).toBe(2);
    expect(result.jury.stoppedBecause).toBe("passed");
  });

  it("does not pass while the devil's advocate has a blocking must_fix", async () => {
    const { client } = scripted({
      draft: () => GOOD,
      objections: (n) =>
        n === 1
          ? [
              {
                category: "safety",
                severity: "must_fix",
                line: 1,
                text: "names a brand",
              },
              {
                category: "meaning",
                severity: "must_fix",
                line: null,
                text: "weak",
              },
            ]
          : [],
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    expect(result.jury.rounds.map((r) => [r.passed, r.devil.blocking])).toEqual(
      [
        [false, 1],
        [true, 0],
      ],
    );
  });

  it("stops at the round cap", async () => {
    const { client } = scripted({
      draft: () => GOOD,
      jury: () => FAIL,
      issues: () => [{ line: 1, problem: "flat" }],
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it", maxRounds: 2 },
      deps(client),
    );
    expect(result.jury).toMatchObject({
      passed: false,
      stoppedBecause: "round_cap",
    });
    expect(result.jury.rounds).toHaveLength(2);
  });

  it("stops at the cost cap", async () => {
    const { client } = scripted({
      draft: () => GOOD,
      jury: () => FAIL,
      issues: () => [{ line: 1, problem: "flat" }],
      cost: 0.02,
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it", maxRounds: 5, costCapUsd: 0.1 },
      deps(client),
    );
    expect(result.jury.stoppedBecause).toBe("cost_cap");
  });

  it("is fail-closed when no judge answers", async () => {
    const { client } = scripted({ draft: () => GOOD, judgesDown: true });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    expect(result.jury).toMatchObject({
      passed: false,
      stoppedBecause: "jury_unavailable",
    });
    expect(result.jury.rounds[0]?.available).toBe(false);
  });

  it("fails loudly when the privacy filter corrupted the writer's reply", async () => {
    const { client } = scripted({
      writerText: JSON.stringify({
        title: "x",
        sections: [
          { id: "verse-1", lines: ["giro con [PERSON_NAME]"] },
          { id: "chorus-1", lines: ["ok"] },
        ],
      }),
    });
    await expect(
      rewrite(analysisFixture(), { lang: "it" }, deps(client)),
    ).rejects.toBeInstanceOf(RedactionError);
  });

  it("stops fail-closed when the filter altered what a judge read, keeping the lyrics", async () => {
    const { client } = scripted({ draft: () => GOOD, redactJudge: true });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    const round = result.jury.rounds[0];
    expect(
      round?.verdicts.find((v) => v.model.includes("haiku"))?.error,
    ).toMatch(/privacy filter/u);
    expect(round?.available).toBe(false);
    expect(round?.issues[0]?.problem).toMatch(/privacy filter/u);
    expect(result.jury).toMatchObject({
      passed: false,
      stoppedBecause: "jury_unavailable",
    });
    expect(result.sections.flatMap((s) => s.lines).map((l) => l.text)).toEqual(
      GOOD,
    );
  });

  it("does not let a devil's advocate that read filter tags clear the draft", async () => {
    const { client } = scripted({
      draft: () => GOOD,
      redactDevil: (n) => n === 1,
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    expect(result.jury.stoppedBecause).toBe("jury_unavailable");
    expect(result.jury.rounds[0]?.devil.blocking).toBe(1);
  });

  it("asks again when the writer returns the wrong number of lines", async () => {
    const { client, counts } = scripted({
      draft: (n) => (n === 1 ? [GOOD[0] ?? ""] : GOOD),
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    expect(counts.writer).toBe(2);
    expect(result.jury.passed).toBe(true);
  });

  it("skips the literal translation when the language does not change", async () => {
    const { client, calls } = scripted({
      draft: () => [
        "a paper boat drifts on a rainy road",
        "keep the lamp lit for me",
      ],
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "en" },
      deps(client),
    );
    expect(calls.some((c) => role(c) === "literal translator")).toBe(false);
    expect(result.originality.flaggedLines).toBe(0);
  });

  it("enforces the section meaning gate by default and only reports it on request", async () => {
    const enforced = await rewrite(
      analysisFixture(),
      { lang: "it", maxRounds: 2 },
      deps(scripted({ draft: () => GOOD }).client, false),
    );
    expect(enforced.jury).toMatchObject({
      passed: false,
      stoppedBecause: "round_cap",
    });
    expect(enforced.jury.rounds[0]?.gates.sectionsOk).toBe(false);
    expect(enforced.originality).toMatchObject({ meaningGate: "enforce" });
    expect(
      enforced.originality.sections.find((s) => s.sectionId === "verse-1"),
    ).toMatchObject({ ok: false, sourceCosine: 0 });
    const reported = await rewrite(
      analysisFixture(),
      { lang: "it", meaningGate: "report" },
      deps(scripted({ draft: () => GOOD }).client, false),
    );
    expect(reported.jury.passed).toBe(true);
    expect(reported.originality.sections.some((s) => !s.ok)).toBe(true);
  });

  it("keeps artist names out of the title it puts in prompts", () => {
    const a = analysisFixture();
    a.title = "The Sixsters - Alone (Official Music Video)";
    expect(songTitle(a)).toBe("Alone");
    a.title = "Night Song";
    expect(songTitle(a)).toBe("Night Song");
  });

  it("refuses a source without sung lines", async () => {
    const a = analysisFixture();
    a.lines = [];
    await expect(
      rewrite(a, { lang: "it" }, deps(scripted().client)),
    ).rejects.toThrow(/no sung lines/u);
  });
});

describe("model routing and cost (task 27)", () => {
  it("drafts and fixes with the cheap model, the strong one only polishes and argues", async () => {
    const { client, calls } = scripted();
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    const models = (r: string) =>
      new Set(calls.filter((c) => role(c) === r).map((c) => c.body.model));
    expect(models("lyric writer for a remake")).toEqual(
      new Set([DEFAULT_MODELS.draft]),
    );
    expect(models("lyric line fixer")).toEqual(new Set([DEFAULT_MODELS.fixer]));
    expect(models("lyric finisher")).toEqual(new Set([DEFAULT_MODELS.final]));
    expect(models("devil's advocate")).toEqual(new Set([DEFAULT_MODELS.devil]));
    expect(DEFAULT_MODELS.draft).toMatch(/haiku/u);
    expect(DEFAULT_MODELS.final).toMatch(/sonnet/u);
    // No call ever goes to the most expensive model.
    expect(calls.some((c) => String(c.body.model).includes("opus"))).toBe(
      false,
    );
    expect(result.cost.calls.map((c) => c.step)).toContain("final-pass");
  });

  it("takes model ids from the options", async () => {
    const { client, calls } = scripted();
    await rewrite(
      analysisFixture(),
      { lang: "it", models: { draft: "x/cheap", final: "x/strong" } },
      deps(client),
    );
    expect(
      calls.filter((c) => role(c) === "lyric writer for a remake")[0]?.body
        .model,
    ).toBe("x/cheap");
    expect(
      calls.filter((c) => role(c) === "lyric finisher")[0]?.body.model,
    ).toBe("x/strong");
  });

  it("keeps the final pass's improvements and reverts a line it made fail a gate", async () => {
    const { client, counts } = scripted({
      draft: () => GOOD,
      finisher: () => [
        { index: 0, text: LITERAL[0] ?? "" },
        { index: 1, text: "la luce resta qui per me" },
      ],
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    expect(counts.finisher).toBe(1);
    expect(result.sections.flatMap((s) => s.lines).map((l) => l.text)).toEqual([
      GOOD[0],
      "la luce resta qui per me",
    ]);
    expect(result.originality.flaggedLines).toBe(0);
  });
});

describe("judges read the source only as a reference (task 27)", () => {
  const states = (texts: string[]) =>
    analysisFixture().lines.map((line, i) => ({
      line,
      sectionId: line.sectionId,
      text: texts[i] ?? "",
    }));

  it("puts no source line inside the block the judges score", () => {
    const user = reviewUser(
      states(GOOD),
      analysisFixture(),
      { lang: "it" },
      "Tram",
    );
    const block = newLyricsBlock(user);
    for (const source of SOURCE)
      expect(block.toLowerCase()).not.toContain(source.toLowerCase());
    expect(user).toMatch(
      /REFERENCE: ORIGINAL SONG, NOT PART OF THE NEW LYRICS/u,
    );
    expect(user.toLowerCase()).toContain(SOURCE[0]?.toLowerCase());
    // The same judge marks a draft that copies the source.
    const copied = reviewUser(
      states(SOURCE),
      analysisFixture(),
      { lang: "en" },
      "x",
    );
    expect(literalScore(newLyricsBlock(copied))).toBeLessThan(0.3);
  });

  it("scores a clearly original draft high on originality, Jev included", async () => {
    const { client, calls } = scripted({
      draft: () => GOOD,
      literalJudges: true,
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it" },
      deps(client),
    );
    const round = result.jury.rounds[0];
    const jev = round?.verdicts.find((v) => v.model.includes("jev"));
    expect(jev?.scores?.original).toBeGreaterThanOrEqual(0.9);
    expect(round?.scores.original).toBeGreaterThanOrEqual(0.9);
    expect(result.jury.passed).toBe(true);
    const state = calls.find((c) => role(c) === "jev")?.body.state as Record<
      string,
      string
    >;
    expect(Object.keys(state)).toEqual([
      "task",
      "new_lyrics",
      "meaning_map",
      "reference_original_song_do_not_score",
    ]);
    expect(state.new_lyrics?.toLowerCase()).not.toContain(
      SOURCE[1]?.toLowerCase(),
    );
  });
});

describe("rewriteSection and checkLyrics (task 27 review)", () => {
  async function first() {
    const { client } = scripted({ draft: () => GOOD });
    return rewrite(analysisFixture(), { lang: "it" }, deps(client));
  }

  it("writes one section again, keeps the others and adds one jury round", async () => {
    const lyrics = await first();
    const { client, calls, counts } = scripted({
      draft: () => [GOOD[0] ?? "", "la luce resta su di me"],
    });
    const next = await rewriteSection(
      analysisFixture(),
      lyrics,
      "chorus-1",
      { lang: "it" },
      deps(client),
    );
    const writer = calls.find((c) => role(c) === "lyric writer for a remake");
    expect(
      String(
        (writer?.body.messages as { content: string }[] | undefined)?.[1]
          ?.content,
      ),
    ).toMatch(/Write new lines for section chorus-1 only/u);
    // The literal translation was kept from the first run: not paid again.
    expect(calls.some((c) => role(c) === "literal translator")).toBe(false);
    expect(counts.devil).toBe(1);
    expect(next.sections.find((s) => s.id === "verse-1")?.lines[0]?.text).toBe(
      GOOD[0],
    );
    expect(next.jury.rounds).toHaveLength(lyrics.jury.rounds.length + 1);
    expect(next.cost.usd).toBeGreaterThan(lyrics.cost.usd);
    expect(next.cost.calls.map((c) => c.step)).toContain("write-section");
  });

  it("runs the gates again on edited lines, never the jury", async () => {
    const lyrics = await first();
    const { client, calls } = scripted();
    const copied = await checkLyrics(
      analysisFixture(),
      lyrics,
      { lines: [{ index: 0, text: LITERAL[0] ?? "" }] },
      { lang: "it" },
      deps(client),
    );
    expect(calls).toHaveLength(0);
    const line = copied.sections.flatMap((s) => s.lines)[0];
    expect(line).toMatchObject({ text: LITERAL[0], edited: true });
    expect(line?.originality.flagged).toBe(true);
    expect(copied.originality.flaggedLines).toBe(1);
    expect(copied.jury.rounds).toEqual(lyrics.jury.rounds);
    const fixed = await checkLyrics(
      analysisFixture(),
      copied,
      {
        lines: [{ index: 0, text: "giro la notte su un tram che va" }],
        title: "Notte in tram",
      },
      { lang: "it" },
      deps(client),
    );
    expect(fixed.originality.flaggedLines).toBe(0);
    expect(fixed.title).toBe("Notte in tram");
    expect(fixed.sections.flatMap((s) => s.lines)[0]?.edited).toBe(true);
  });
});
