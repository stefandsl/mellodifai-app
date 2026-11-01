import { expect, it } from "vitest";

import {
  parseTakeScores,
  suggestTake,
  type TakeScores,
} from "./suggest-take.js";

function scores(patch: Partial<TakeScores> = {}): TakeScores {
  return {
    fidelity: 0.8,
    duration: 200,
    endDropDb: 30,
    weakSections: [],
    truncated: false,
    ...patch,
  };
}

it("suggests the take with clearly more recognised words", () => {
  const picked = suggestTake([
    { id: "a", scores: scores({ fidelity: 0.91 }) },
    { id: "b", scores: scores({ fidelity: 0.72 }) },
  ]);
  expect(picked).toEqual({ takeId: "a", reason: "fidelity", fidelity: 0.91 });
});

it("needs the lead to reach 0.03", () => {
  const close = [
    { id: "a", scores: scores({ fidelity: 0.84 }) },
    { id: "b", scores: scores({ fidelity: 0.82 }) },
  ];
  // Both end cleanly, so the ending cannot separate them either.
  expect(suggestTake(close)).toBeNull();
  expect(
    suggestTake([
      { id: "a", scores: scores({ fidelity: 0.85 }) },
      { id: "b", scores: scores({ fidelity: 0.82 }) },
    ])?.takeId,
  ).toBe("a");
});

it("does not trust a fidelity below 0.6 and falls back to the ending", () => {
  const picked = suggestTake([
    { id: "a", scores: scores({ fidelity: 0.55, endDropDb: 4 }) },
    { id: "b", scores: scores({ fidelity: 0.3, endDropDb: 40 }) },
  ]);
  expect(picked).toEqual({ takeId: "b", reason: "ending" });
});

it("falls back to the only take that is whole and ends cleanly", () => {
  expect(
    suggestTake([
      { id: "a", scores: scores({ fidelity: 0.7, truncated: true }) },
      { id: "b", scores: scores({ fidelity: 0.7 }) },
    ]),
  ).toEqual({ takeId: "b", reason: "ending" });
  expect(
    suggestTake([
      { id: "a", scores: scores({ fidelity: 0.7, endDropDb: 12 }) },
      { id: "b", scores: scores({ fidelity: 0.7 }) },
    ]),
  ).toEqual({ takeId: "b", reason: "ending" });
});

it("suggests nothing when both or neither take qualifies", () => {
  expect(
    suggestTake([
      { id: "a", scores: scores({ fidelity: 0.7, truncated: true }) },
      { id: "b", scores: scores({ fidelity: 0.7, endDropDb: 3 }) },
    ]),
  ).toBeNull();
});

it("suggests nothing until every take has scores", () => {
  expect(suggestTake([])).toBeNull();
  expect(suggestTake([{ id: "a", scores: scores() }])).toBeNull();
  expect(
    suggestTake([
      { id: "a", scores: scores({ fidelity: 0.95 }) },
      { id: "b", scores: null },
    ]),
  ).toBeNull();
});

it("reads stored scores and ignores anything that is not a full score", () => {
  expect(parseTakeScores(scores())).toEqual(scores());
  expect(parseTakeScores({})).toBeNull();
  expect(parseTakeScores(null)).toBeNull();
  expect(parseTakeScores({ fidelity: "high" })).toBeNull();
});
