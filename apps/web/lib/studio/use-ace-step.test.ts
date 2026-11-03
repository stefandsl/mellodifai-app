import { describe, expect, it } from "vitest";
import { parseEngines } from "./engines";
import { aceStepView } from "./use-ace-step";

describe("native ACE-Step state", () => {
  it("reads the local engine state the worker publishes", () => {
    const now = Date.parse("2026-11-01T10:00:00Z");
    const seen = "2026-11-01T09:59:50Z";
    expect(
      aceStepView(
        {
          last_seen: seen,
          engines: { "ace-step": { state: "installing", step: "install" } },
        },
        now,
      ),
    ).toEqual({
      status: { state: "installing", step: "install" },
      online: true,
    });
    expect(aceStepView({ last_seen: seen, engines: {} }, now).status).toEqual({
      state: "not_installed",
    });
    expect(aceStepView(null, now).online).toBe(false);
  });

  it("offers the engine from the combined entry the worker writes", () => {
    const entry = {
      installed: true,
      passedLangs: ["it"],
      minutesPerAudioMinute: 0.8,
      features: [],
      checkedAt: "2026-11-01T10:00:00Z",
      state: "installing",
      step: "download_models",
      pct: 40,
    };
    expect(parseEngines({ "ace-step": entry })["ace-step"]).toMatchObject({
      installed: true,
      passedLangs: ["it"],
      features: [],
    });
    expect(
      aceStepView({ last_seen: null, engines: { "ace-step": entry } }).status,
    ).toMatchObject({ state: "installing", step: "download_models", pct: 40 });
  });
});
