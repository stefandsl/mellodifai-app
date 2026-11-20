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

  const reply = (content: Record<string, unknown>) =>
    vi.fn(async () =>
      json({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    );
  const yes = Object.fromEntries(keys.map((key) => [key, "yes"]));

  it("reads yes, partly and no ratings as 1, 0.5 and 0", async () => {
    const fetchFn = reply({
      lyrics_language: "Italian",
      scores: { ...yes, singable: "partly", chorus: "no", topic: 0.8 },
    });
    const report = await judge(draft, context, ["m"], { key: "k", fetchFn });
    expect(report.scores).toEqual({
      ...all(1),
      singable: 0.5,
      chorus: 0,
      topic: 0.8,
    });
    expect(report.failing).toEqual(["singable", "chorus"]);
  });

  it("fails the language when the judge reads another language", async () => {
    const fetchFn = reply({ lyrics_language: "English", scores: yes });
    const report = await judge(draft, context, ["m"], { key: "k", fetchFn });
    expect(report.failing).toEqual(["language"]);
    expect(report.issues[0]).toContain("English, not Italian");
  });

  it("fails the language when the lyrics use another script", async () => {
    const fetchFn = reply({ lyrics_language: "Korean", scores: yes });
    const report = await judge(
      { ...draft, lyrics: "[Chorus]\nハ・ン・コ！\n見ないで ポン！" },
      { ...context, lang: "ko" },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(report.failing).toEqual(["language"]);
    const ok = await judge(
      { ...draft, lyrics: "[Chorus]\n대충 해도 괜찮아! OK" },
      { ...context, lang: "ko" },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(ok.passed).toBe(true);
  });

  it("fails originality when the draft reuses the reference title", async () => {
    const fetchFn = reply({ lyrics_language: "Italian", scores: yes });
    const reused = await judge(
      { ...draft, lyrics: "[Chorus]\nVa bene... passa! la macchinetta" },
      context,
      ["m"],
      { key: "k", fetchFn },
    );
    expect(reused.failing).toEqual(["original"]);
    const fine = await judge(
      { ...draft, lyrics: "[Chorus]\nva bene il caffè, passa il tram" },
      context,
      ["m"],
      { key: "k", fetchFn },
    );
    expect(fine.passed).toBe(true);
  });

  it("sends the brief and the reference lyrics only when they are known", async () => {
    const fetchFn = reply({ lyrics_language: "Italian", scores: yes });
    await judge(
      draft,
      {
        ...context,
        brief: "ritornello in inglese",
        referenceLyrics: "il treno delle sei",
      },
      ["m"],
      { key: "k", fetchFn },
    );
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("User's brief");
    expect(String(init.body)).toContain("ritornello in inglese");
    expect(String(init.body)).toContain("il treno delle sei");
    await judge(draft, context, ["m"], { key: "k", fetchFn });
    const [, plain] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(String(plain.body)).not.toContain("User's brief");
    expect(String(plain.body)).not.toContain("Reference song lyrics");
  });

  it("fails originality when the draft paraphrases the reference lyrics", async () => {
    const fetchFn = reply({ lyrics_language: "Italian", scores: yes });
    const referenceLyrics =
      "[Verse]\nIl treno delle sei non aspetta nessuno,\ncorro sul binario col caffè in mano,\nil capotreno fischia e io salto su,\ne la città si sveglia piano piano.";
    const copied = await judge(
      {
        ...draft,
        lyrics:
          "[Verse]\nIl treno dell'alba non aspetta mai nessuno,\ncorro lungo il binario col caffè in mano,\nil controllore fischia e io salgo su,\ne la città si sveglia lentamente.",
      },
      { ...context, referenceLyrics },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(copied.failing).toEqual(["original"]);
    const fresh = await judge(
      {
        ...draft,
        lyrics:
          "[Verse]\nLa sveglia suona quando è ancora notte,\nmi vesto al buio senza far rumore,\nla stazione è fredda e mezza vuota,\nun panino e già passano le ore.",
      },
      { ...context, referenceLyrics },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(fresh.passed).toBe(true);
  });

  it("fails singability when two chorus lines overflow the melody", async () => {
    const fetchFn = reply({ lyrics_language: "Italian", scores: yes });
    const chorus = [
      "Domenica dalla nonna,",
      "la tavola è già pronta,",
      "domenica dalla nonna,",
    ];
    const long =
      "e c'è sempre un piatto in più per chiunque bussi alla porta di casa";
    const overflow = await judge(
      {
        ...draft,
        lyrics: `[Chorus]\n${[...chorus, long, `${long} sua`].join("\n")}`,
      },
      context,
      ["m"],
      { key: "k", fetchFn },
    );
    expect(overflow.failing).toEqual(["singable"]);
    const one = await judge(
      { ...draft, lyrics: `[Chorus]\n${[...chorus, long].join("\n")}` },
      context,
      ["m"],
      { key: "k", fetchFn },
    );
    expect(one.passed).toBe(true);
    const verse = await judge(
      {
        ...draft,
        lyrics: `[Verse 1]\n${[...chorus, long, `${long} sua`].join("\n")}`,
      },
      context,
      ["m"],
      { key: "k", fetchFn },
    );
    expect(verse.passed).toBe(true);
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

describe("deterministic checks on real data shapes", () => {
  const yes = Object.fromEntries(keys.map((key) => [key, "yes"]));
  const reply = (content: Record<string, unknown>) =>
    vi.fn(async () =>
      json({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    );

  it("asks judges for a language code and accepts codes and common names", async () => {
    const fetchFn = reply({ lyrics_language: "it", scores: yes });
    expect(
      (await judge(draft, context, ["m"], { key: "k", fetchFn })).passed,
    ).toBe(true);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("ISO 639-1");
    const lyricsFor: Record<string, string> = {
      zh: "[Chorus]\n差不多就好",
      ja: "[Chorus]\nみないで",
    };
    for (const [lang, seen] of [
      ["it", "Italiano"],
      ["zh", "Mandarin"],
      ["zh", "Chinese (Simplified)"],
      ["pt", "Brazilian Portuguese"],
      ["ja", "日本語"],
      ["ro-RO", "ro"],
    ] as const) {
      const report = await judge(
        { ...draft, lyrics: lyricsFor[lang] ?? draft.lyrics },
        { ...context, lang },
        ["m"],
        { key: "k", fetchFn: reply({ lyrics_language: seen, scores: yes }) },
      );
      expect(report.passed, `${lang} ${seen}`).toBe(true);
    }
  });

  it("counts one judge's language mismatch as partly, not as a zero", async () => {
    const single = await judge(draft, context, ["m"], {
      key: "k",
      fetchFn: reply({ lyrics_language: "en", scores: yes }),
    });
    expect(single.scores.language).toBe(0.5);
    expect(single.issues[0]).toContain("English, not Italian");
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string;
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                lyrics_language: model === "a" ? "English" : "it",
                scores: yes,
              }),
            },
          },
        ],
      });
    });
    const jury = await judge(draft, context, ["a", "b", "c"], {
      key: "k",
      fetchFn: fetchFn as never,
    });
    expect(jury.scores.language).toBe(0.83);
    expect(jury.passed).toBe(true);
  });

  const verse = [
    "[Verse 1]",
    "あさのひかり まどをあける",
    "コーヒーのかおり へやにみちる",
    "[Verse 2]",
    "ゆうぐれのみち ひとりあるく",
    "かぜがやさしく かみをゆらす",
  ].join("\n");
  const englishChorus = [
    "[Chorus]",
    "Everything is gonna be alright tonight, alright tonight",
    "We keep on dancing underneath the city lights forever",
    "Everything is gonna be alright tonight, alright tonight",
  ].join("\n");

  it("lets a Japanese or Korean song with an English chorus pass the script check", async () => {
    const report = await judge(
      {
        ...draft,
        lyrics: `${verse}\n${englishChorus}\n${englishChorus}\n${englishChorus}`,
      },
      { ...context, lang: "ja" },
      ["m"],
      { key: "k", fetchFn: reply({ lyrics_language: "ja", scores: yes }) },
    );
    expect(report.passed).toBe(true);
    const korean = await judge(
      {
        ...draft,
        lyrics: `[Verse]\n아침 햇살 창문을 열어\n커피 향기 방에 가득해\n저녁 길을 혼자 걸어\n${englishChorus}\n${englishChorus}`,
      },
      { ...context, lang: "ko" },
      ["m"],
      { key: "k", fetchFn: reply({ lyrics_language: "ko", scores: yes }) },
    );
    expect(korean.passed).toBe(true);
  });

  it("skips the script check when the brief allows a second language", async () => {
    const lyrics = `[Verse]\nあさのひかり\n${englishChorus}\n[Bridge]\nWe keep on running through the night\nNever looking back again`;
    const fetchFn = reply({ lyrics_language: "ja", scores: yes });
    const strict = await judge(
      { ...draft, lyrics },
      { ...context, lang: "ja" },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(strict.failing).toEqual(["language"]);
    const allowed = await judge(
      { ...draft, lyrics },
      {
        ...context,
        lang: "ja",
        brief: "J-POP。サビに英語のフレーズを入れてもよい。",
      },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(allowed.passed).toBe(true);
  });

  it("rates romaji Japanese as partly unless the brief demands kana or kanji", async () => {
    const romaji = {
      ...draft,
      lyrics:
        "[Verse]\nasa no hikari mado wo akete\nkoohii no kaori heya ni michiru\n[Chorus]\nminaide pon, minaide pon\nkyou mo ashita mo daijoubu",
    };
    const fetchFn = reply({ lyrics_language: "ja", scores: yes });
    const plain = await judge(romaji, { ...context, lang: "ja" }, ["m"], {
      key: "k",
      fetchFn,
    });
    expect(plain.scores.language).toBe(0.5);
    const kana = await judge(
      romaji,
      { ...context, lang: "ja", brief: "ひらがなと漢字で書いてください。" },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(kana.scores.language).toBe(0);
    const english = await judge(
      {
        ...draft,
        lyrics: `[Verse]\nThe morning light comes through the window\n${englishChorus}`,
      },
      { ...context, lang: "ja" },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(english.scores.language).toBe(0);
  });

  // Real lines of versions/it/title.txt and versions/ja/title.txt (suno-remake engine).
  it("catches a reused reference title written with its trailing tag", async () => {
    const fetchFn = reply({ lyrics_language: "it", scores: yes });
    const reused = await judge(
      { ...draft, lyrics: "[Chorus]\nVa bene... passa! la macchinetta" },
      { ...context, referenceTitle: "Va bene, passa (VBP)" },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(reused.failing).toEqual(["original"]);
    const japanese = await judge(
      { ...draft, lyrics: "[Chorus]\nねえ見ないでポン！おねがい" },
      { ...context, lang: "ja", referenceTitle: "見ないでポン！(ハンコ)" },
      ["m"],
      { key: "k", fetchFn: reply({ lyrics_language: "ja", scores: yes }) },
    );
    expect(japanese.failing).toEqual(["original"]);
    const fine = await judge(
      { ...draft, lyrics: "[Chorus]\nva bene il caffè, passa il tram" },
      { ...context, referenceTitle: "Va bene, passa (VBP)" },
      ["m"],
      { key: "k", fetchFn },
    );
    expect(fine.passed).toBe(true);
  });
});
