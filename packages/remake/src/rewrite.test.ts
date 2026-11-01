import { describe, expect, it } from "vitest";
import { createClient, RedactionError } from "./openrouter.js";
import { rewrite } from "./rewrite.js";
import {
  analysisFixture,
  chatReply,
  type FakeCall,
  fakeFetch,
} from "./test-fixtures.js";

const LITERAL = [
  "Cammino da solo per le strade vuote",
  "Tieniti alla luce stanotte",
];
const GOOD = [
  "giro la notte su un tram che non va",
  "la luce resta qui con me",
];
const PASS = {
  singability: 0.9,
  meaning: 0.85,
  originality: 0.9,
  safety: 0.95,
};
const FAIL = { ...PASS, singability: 0.4 };

function role(call: FakeCall): string {
  const messages = call.body.messages as { content: string }[] | undefined;
  if (call.url.endsWith("/v1/embeddings")) return "embed";
  if (call.url.endsWith("/alpha/decisions")) return "jev";
  return (
    /ROLE: ([a-z' ]+)/u.exec(messages?.[0]?.content ?? "")?.[1]?.trim() ?? "?"
  );
}

// One-hot vectors: every distinct text is orthogonal to every other one.
function embeddings(call: FakeCall, dims: Map<string, number>) {
  const input = call.body.input as string[];
  return {
    data: input.map((text, index) => {
      if (!dims.has(text)) dims.set(text, dims.size);
      const v = new Array(64).fill(0);
      v[(dims.get(text) ?? 0) % 64] = 1;
      return { index, embedding: v };
    }),
    usage: { prompt_tokens: 10, cost: 0.000001 },
  };
}

type Script = {
  draft?: (n: number) => string[];
  jury?: (round: number) => typeof PASS;
  blockers?: (round: number) => string[];
  writerText?: string;
  cost?: number;
};

function scripted(script: Script = {}) {
  const dims = new Map<string, number>();
  const counts = { lyric: 0, jury: 0, devil: 0, fixer: 0 };
  const { fetchFn, calls } = fakeFetch((call) => {
    const r = role(call);
    const cost = script.cost ?? 0.001;
    switch (r) {
      case "embed":
        return embeddings(call, dims);
      case "jev":
        return {
          answers: Object.fromEntries(
            Object.entries(script.jury?.(counts.devil + 1) ?? PASS).map(
              ([k, v]) => [k, { noul: v }],
            ),
          ),
        };
      case "literal translator":
        return chatReply({ lines: LITERAL }, cost);
      case "lyric writer for a remake": {
        counts.lyric++;
        if (script.writerText) return chatReply(script.writerText, cost);
        const lines = script.draft?.(counts.lyric) ?? [LITERAL[0], GOOD[1]];
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
      case "lyric line fixer":
        counts.fixer++;
        return chatReply({ lines: [{ index: 0, text: GOOD[0] }] }, cost);
      case "judge of remake lyrics":
        counts.jury++;
        return chatReply(
          {
            scores: script.jury?.(counts.devil + 1) ?? PASS,
            issues: ["line 1 is a bit flat"],
          },
          cost,
        );
      case "devil's advocate":
        counts.devil++;
        return chatReply(
          {
            blockers: script.blockers?.(counts.devil) ?? [],
            objections: ["the title is plain"],
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

describe("rewrite", () => {
  it("fixes a literally translated line, passes the jury and logs the cost", async () => {
    const { client, counts } = scripted();
    const result = await rewrite(analysisFixture(), { lang: "it" }, { client });
    expect(counts.fixer).toBe(1);
    expect(result.jury).toMatchObject({
      passed: true,
      stoppedBecause: "passed",
    });
    expect(result.jury.rounds).toHaveLength(1);
    expect(result.jury.rounds[0]?.devil.objections).toEqual([
      "the title is plain",
    ]);
    expect(result.originality.flaggedLines).toBe(0);
    expect(result.originality.semanticAvailable).toBe(true);
    const lines = result.sections.flatMap((s) => s.lines);
    expect(lines.map((l) => l.text)).toEqual(GOOD);
    expect(lines.every((l) => l.fits)).toBe(true);
    expect(result.lyricsText).toBe(
      "[Intro]\n\n[Verse 1]\ngiro la notte su un tram che non va\n\n[Chorus 1]\nla luce resta qui con me",
    );
    expect(result.title).toBe("Tram di notte");
    expect(result.cost.usd).toBeGreaterThan(0);
    expect(result.cost.calls.map((c) => c.step)).toEqual(
      expect.arrayContaining([
        "translate-literal",
        "write",
        "fix-lines",
        "jury:devil",
        "originality:embeddings",
      ]),
    );
    expect(result.styleTags).not.toContain("night song");
  });

  it("revises the whole draft when the jury fails, then passes", async () => {
    const { client, counts } = scripted({
      draft: () => GOOD,
      jury: (round) => (round === 1 ? FAIL : PASS),
    });
    const result = await rewrite(analysisFixture(), { lang: "it" }, { client });
    expect(counts.lyric).toBe(2);
    expect(result.jury.rounds.map((r) => r.passed)).toEqual([false, true]);
    expect(result.jury.rounds[0]?.failing).toEqual(["singability"]);
    expect(result.jury.stoppedBecause).toBe("passed");
  });

  it("does not pass while the devil's advocate has a blocker", async () => {
    const { client } = scripted({
      draft: () => GOOD,
      blockers: (round) => (round === 1 ? ['"tram" is a brand'] : []),
    });
    const result = await rewrite(analysisFixture(), { lang: "it" }, { client });
    expect(result.jury.rounds.map((r) => r.passed)).toEqual([false, true]);
  });

  it("stops at the round cap", async () => {
    const { client } = scripted({ draft: () => GOOD, jury: () => FAIL });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it", maxRounds: 2 },
      { client },
    );
    expect(result.jury).toMatchObject({
      passed: false,
      stoppedBecause: "round-cap",
    });
    expect(result.jury.rounds).toHaveLength(2);
  });

  it("stops at the cost cap", async () => {
    const { client } = scripted({
      draft: () => GOOD,
      jury: () => FAIL,
      cost: 0.02,
    });
    const result = await rewrite(
      analysisFixture(),
      { lang: "it", maxRounds: 5, costCapUsd: 0.1 },
      { client },
    );
    expect(result.jury.stoppedBecause).toBe("cost-cap");
    expect(result.jury.rounds.length).toBeLessThan(5);
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
      rewrite(analysisFixture(), { lang: "it" }, { client }),
    ).rejects.toBeInstanceOf(RedactionError);
  });

  it("asks again when the writer returns the wrong number of lines", async () => {
    const { client, counts } = scripted({
      draft: (n) => (n === 1 ? [GOOD[0] ?? ""] : GOOD),
    });
    const result = await rewrite(analysisFixture(), { lang: "it" }, { client });
    expect(counts.lyric).toBe(2);
    expect(result.jury.passed).toBe(true);
  });

  it("skips the literal translation when the language does not change", async () => {
    const { client, calls } = scripted({
      draft: () => [
        "a paper boat drifts down the gutter",
        "keep the lamp lit for me",
      ],
    });
    const result = await rewrite(analysisFixture(), { lang: "en" }, { client });
    expect(calls.some((c) => role(c) === "literal translator")).toBe(false);
    expect(result.originality.flaggedLines).toBe(0);
  });

  it("refuses a source without sung lines", async () => {
    const a = analysisFixture();
    a.lines = [];
    await expect(
      rewrite(a, { lang: "it" }, { client: scripted().client }),
    ).rejects.toThrow(/no sung lines/u);
  });
});
