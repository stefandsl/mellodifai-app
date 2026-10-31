import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { JuryPanel, modelName } from "./jury-panel";

const scores = {
  topic: 0.96,
  language: 0.72,
  singable: 0.59,
  chorus: 0.79,
  original: 0.89,
};

it("names models the way people say them", () => {
  expect(modelName("anthropic/claude-opus-5.5")).toBe("Opus 5.5");
  expect(modelName("google/gemini-3.8-flash")).toBe("Gemini 3.8 flash");
  expect(modelName("typesafe/jev-1.14")).toBe("Jev");
});

it("shows the verdict, the writer, the rewrites, each score and the filter warning", () => {
  render(
    <JuryPanel
      jury={{
        passed: false,
        available: true,
        scores,
        failing: ["singable"],
        redacted: true,
        rounds: [
          { writer: "anthropic/claude-opus-5.5", passed: false },
          { writer: "anthropic/claude-opus-5.5", passed: false },
        ],
        verdicts: [
          { model: "typesafe/jev-1.14", ms: 427 },
          { model: "anthropic/claude-haiku-5.5", ms: 6773 },
          { model: "google/gemini-3.8-flash", ms: 0, error: "timeout" },
        ],
        ms: 214132,
      }}
    />,
  );
  expect(screen.getByText("La giuria non è convinta")).toBeVisible();
  expect(screen.getByText(/2 giudici · 214\.1 s/u)).toBeVisible();
  expect(screen.getByText("Opus 5.5")).toBeVisible();
  expect(screen.getByText(/riscritto 1 volta/u)).toBeVisible();
  expect(screen.getByText("59%")).toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent("filtro privacy");
});

it("says plainly when no judge could answer", () => {
  render(
    <JuryPanel
      jury={{ passed: true, available: false, scores: {}, failing: [] }}
    />,
  );
  expect(
    screen.getByText("Giuria non disponibile: controlla tu il testo"),
  ).toBeVisible();
  expect(screen.queryByText("Tema")).toBeNull();
});
