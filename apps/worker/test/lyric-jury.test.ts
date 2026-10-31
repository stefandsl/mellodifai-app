import { describe, expect, it, vi } from "vitest";

import {
  CRITERIA,
  combine,
  JEV,
  judge,
  looksRedacted,
  REDACTION_NOTE,
  revisionBrief,
  route,
  type Verdict,
} from "../src/stages/lyric-jury.js";

const DECISIONS = "https://openrouter.ai/api/alpha/decisions";
const keys = Object.keys(CRITERIA) as (keyof typeof CRITERIA)[];
const all = (value: number) =>
  Object.fromEntries(keys.map((key) => [key, value])) as Record<
    keyof typeof CRITERIA,
    number
  >;
const draft = {
  title: "Caffè",
  lyrics: "[Verse]\nla macchinetta",
  style: "pop",
};
const context = {
  topic: "macchinetta del caffè",
  lang: "it",
  referenceTitle: "Va bene, passa",
};

function json(value: unknown) {
  return new Response(JSON.stringify(value));
}

describe("combine", () => {
  it("passes only when every criterion's mean reaches the threshold", () => {
    const report = combine(
      [
        { model: "a", ms: 1, scores: { ...all(0.9), topic: 0.5 } },
        { model: "b", ms: 1, scores: { ...all(0.9), topic: 0.8 } },
      ],
      5,
    );
    expect(report).toMatchObject({
      available: true,
      passed: false,
      failing: ["topic"],
    });
    expect(report.scores.topic).toBe(0.65);
  });

  it("ignores failed judges and passes through when no judge answered", () => {
    const failed: Verdict = { model: "x", ms: 1, error: "timeout" };
    expect(combine([failed], 3)).toMatchObject({
      available: false,
      passed: true,
    });
    expect(
      combine([failed, { model: "a", ms: 1, scores: all(0.8) }], 3),
    ).toMatchObject({ available: true, passed: true });
  });

  it("lets the majority pick who improves the draft", () => {
    const vote = (improver: "strong" | "fast"): Verdict => ({
      model: improver,
      ms: 1,
      scores: all(0.2),
      improver,
    });
    expect(
      combine([vote("fast"), vote("fast"), vote("strong")], 1).improver,
    ).toBe("fast");
    expect(combine([vote("fast"), vote("strong")], 1).improver).toBe("strong");
  });

  it("turns failing criteria and issues into a revision brief", () => {
    const brief = revisionBrief(
      combine(
        [
          {
            model: "a",
            ms: 1,
            scores: { ...all(0.9), chorus: 0.3 },
            issues: ['"la la" is filler'],
          },
        ],
        1,
      ),
    );
    expect(brief).toContain("chorus (score 0.3");
    expect(brief).toContain('"la la" is filler');
    expect(brief).not.toContain("topic (");
  });
});

describe("route", () => {
  it("asks Jev for tone and writer and takes a confident fast choice", async () => {
    const fetchFn = vi.fn(async () =>
      json({
        answers: {
          tone: { choice: "ironic", confidence: 0.9 },
          writer: { choice: "fast", confidence: 0.8 },
        },
      }),
    );
    const plan = await route(
      { topic: "caffè", brief: "", style: "", lang: "it" },
      { key: "k", fetchFn },
    );
    expect(plan).toMatchObject({ tone: "ironic", writer: "fast" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(DECISIONS);
    expect(JSON.parse(String(init.body)).model).toBe(JEV);
  });

  it("falls back to the strong writer when Jev is unsure or down", async () => {
    const unsure = vi.fn(async () =>
      json({ answers: { writer: { choice: "fast", confidence: 0.4 } } }),
    );
    expect(
      (
        await route(
          { topic: "x", brief: "", style: "", lang: "it" },
          { key: "k", fetchFn: unsure },
        )
      ).writer,
    ).toBe("strong");
    const down = vi.fn(async () => new Response("no", { status: 503 }));
    const plan = await route(
      { topic: "x", brief: "", style: "", lang: "it" },
      { key: "k", fetchFn: down },
    );
    expect(plan).toMatchObject({ writer: "strong", tone: null });
    expect(plan.error).toContain("503");
  });
});

describe("judge", () => {
  it("runs Jev and chat judges in parallel and averages their scores", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === DECISIONS)
        return json({
          answers: {
            ...Object.fromEntries(keys.map((key) => [key, { noul: 0.9 }])),
            improver: { choice: "strong" },
          },
        });
      const model = JSON.parse(String(init?.body)).model as string;
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                scores: {
                  ...all(0.8),
                  topic: model.includes("haiku") ? 0.5 : 0.8,
                },
                issues: ["the chorus never names the coffee machine"],
                improver: "strong",
              }),
            },
          },
        ],
      });
    });
    const report = await judge(
      draft,
      context,
      [JEV, "anthropic/claude-haiku-5.5", "google/gemini-3.8-flash"],
      { key: "k", fetchFn: fetchFn as never },
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(report.verdicts.map((v) => v.model)).toEqual([
      JEV,
      "anthropic/claude-haiku-5.5",
      "google/gemini-3.8-flash",
    ]);
    expect(report.scores.topic).toBe(0.73);
    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([
      "the chorus never names the coffee machine",
    ]);
  });

  it("drops a judge that answers without every score", async () => {
    const fetchFn = vi.fn(async () =>
      json({ choices: [{ message: { content: '{"scores":{"topic":1}}' } }] }),
    );
    const report = await judge(draft, context, ["m"], { key: "k", fetchFn });
    expect(report).toMatchObject({ available: false, passed: true });
    expect(report.verdicts[0]?.error).toContain("incomplete");
  });
});

describe("privacy filter", () => {
  it("spots filter tags but not section tags", () => {
    expect(looksRedacted("[PERSON_NAME] Roma 12")).toBe(true);
    expect(looksRedacted("via [ADDRESS]")).toBe(true);
    expect(looksRedacted("[Verse 1]\n[Chorus]\nla macchinetta")).toBe(false);
  });

  it("flags a jury whose judges saw filter tags instead of words", () => {
    const report = combine(
      [
        {
          model: "a",
          ms: 1,
          scores: all(0.5),
          issues: ["lines are corrupted by placeholders such as [ADDRESS]"],
        },
      ],
      1,
    );
    expect(report.redacted).toBe(true);
    expect(combine([{ model: "a", ms: 1, scores: all(0.9) }], 1).redacted).toBe(
      false,
    );
  });

  it("tells chat judges that filter tags are not part of the song", async () => {
    const fetchFn = vi.fn(async () =>
      json({ choices: [{ message: { content: "{}" } }] }),
    );
    await judge(draft, context, ["m"], { key: "k", fetchFn });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain(REDACTION_NOTE.slice(0, 40));
  });
});
