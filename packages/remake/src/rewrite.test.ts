import { describe, expect, it } from "vitest";
import { createClient, RedactionError } from "./openrouter.js";
import type { Embed } from "./originality.js";
import { rewrite, songTitle } from "./rewrite.js";
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
};

function scripted(script: Script = {}) {
  const counts = { writer: 0, judge: 0, devil: 0, fixer: 0 };
  const round = () => counts.devil + 1;
  const { fetchFn, calls } = fakeFetch((call) => {
    const r = role(call);
    const cost = script.cost ?? 0.001;
    if (script.judgesDown && (r === "jev" || r === "judge of remake lyrics"))
      return { status: 500, text: "down" };
    switch (r) {
      case "jev":
        return {
          answers: Object.fromEntries(
            Object.entries(script.jury?.(round()) ?? PASS).map(([k, v]) => [
              k,
              { noul: v },
            ]),
          ),
        };
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
      case "judge of remake lyrics":
        counts.judge++;
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

  it("discards a judge that read filter tags but keeps the others", async () => {
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
    expect(round?.available).toBe(true);
    expect(result.jury.passed).toBe(true);
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
    expect(result.jury.rounds.map((r) => r.passed)).toEqual([false, true]);
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
