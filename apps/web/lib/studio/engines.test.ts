import { describe, expect, it } from "vitest";
import {
  type EngineInfo,
  engineControls,
  engineLabel,
  engineOptions,
  expectedMinutes,
  kieCredits,
  localCost,
  minutesPhrase,
  parseEngines,
  songsTotal,
  unavailableReason,
} from "./engines";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const seen = (secondsAgo: number) =>
  new Date(NOW - secondsAgo * 1000).toISOString();

const ENGINES = parseEngines({
  yue2: {
    installed: true,
    passedLangs: ["it"],
    minutesPerAudioMinute: 1.6,
    checkedAt: "2026-11-01T11:59:00Z",
  },
  "ace-step": {
    installed: true,
    passedLangs: ["it"],
    minutesPerAudioMinute: 0.8,
    checkedAt: "2026-11-01T11:59:00Z",
  },
});

const YUE2 = ENGINES.yue2 as EngineInfo;

const ctx = {
  isAdmin: true,
  engines: ENGINES,
  lastSeen: seen(10),
  languages: ["it" as const],
  now: NOW,
};

describe("parseEngines", () => {
  it("keeps well-formed entries of known engines and drops the rest", () => {
    expect(Object.keys(ENGINES).sort()).toEqual(["ace-step", "yue2"]);
    const parsed = parseEngines({
      yue2: { installed: true, passedLangs: ["it"], minutesPerAudioMinute: 0 },
      "ace-step": {
        installed: "yes",
        passedLangs: ["it"],
        minutesPerAudioMinute: 1,
      },
      kie: { installed: true, passedLangs: [], minutesPerAudioMinute: 1 },
      other: { installed: true, passedLangs: [], minutesPerAudioMinute: 1 },
    });
    expect(parsed).toEqual({});
  });

  it("treats anything that is not an object as no engines", () => {
    expect(parseEngines(null)).toEqual({});
    expect(parseEngines("x")).toEqual({});
    expect(parseEngines([])).toEqual({});
  });
});

describe("engineOptions", () => {
  it("offers kie plus every qualifying local engine to the admin", () => {
    expect(engineOptions(ctx)).toEqual(["kie", "ace-step", "yue2"]);
  });

  it("offers nothing but kie to anyone who is not the admin", () => {
    expect(engineOptions({ ...ctx, isAdmin: false })).toEqual(["kie"]);
  });

  it("drops an engine that is not installed", () => {
    const engines = {
      ...ENGINES,
      yue2: { ...YUE2, installed: false },
    };
    expect(engineOptions({ ...ctx, engines })).toEqual(["kie", "ace-step"]);
  });

  it("requires every chosen language in passedLangs", () => {
    expect(engineOptions({ ...ctx, languages: ["it", "en"] })).toEqual(["kie"]);
    expect(engineOptions({ ...ctx, languages: ["en"] })).toEqual(["kie"]);
    const engines = {
      ...ENGINES,
      yue2: { ...YUE2, passedLangs: ["it" as const, "en" as const] },
    };
    expect(engineOptions({ ...ctx, engines, languages: ["it", "en"] })).toEqual(
      ["kie", "yue2"],
    );
  });

  it("needs the worker seen in the last 60 seconds", () => {
    expect(engineOptions({ ...ctx, lastSeen: seen(60) })).toContain("yue2");
    expect(engineOptions({ ...ctx, lastSeen: seen(61) })).toEqual(["kie"]);
    expect(engineOptions({ ...ctx, lastSeen: null })).toEqual(["kie"]);
  });

  it("offers kie while no language is chosen yet and no engine is reported", () => {
    expect(engineOptions({ ...ctx, languages: [] })).toEqual([
      "kie",
      "ace-step",
      "yue2",
    ]);
    expect(engineOptions({ ...ctx, engines: {} })).toEqual(["kie"]);
  });
});

describe("unavailableReason", () => {
  it("says why a local engine stopped qualifying, most basic cause first", () => {
    expect(unavailableReason("ace-step", ctx)).toBeNull();
    expect(unavailableReason("kie", ctx)).toBeNull();
    expect(unavailableReason("ace-step", { ...ctx, isAdmin: false })).toBe(
      "admin",
    );
    expect(unavailableReason("ace-step", { ...ctx, engines: {} })).toBe(
      "installed",
    );
    expect(unavailableReason("ace-step", { ...ctx, lastSeen: seen(90) })).toBe(
      "offline",
    );
    expect(
      unavailableReason("ace-step", { ...ctx, languages: ["it", "en"] }),
    ).toBe("lang");
  });
});

describe("expected length and cost", () => {
  it("uses the chosen duration, else 3.5 minutes", () => {
    expect(expectedMinutes("ace-step", 120)).toBe(2);
    expect(expectedMinutes("ace-step", null)).toBe(3.5);
    expect(expectedMinutes("ace-step", undefined)).toBe(3.5);
  });

  it("ignores the duration for YuE2, which decides its own length", () => {
    expect(expectedMinutes("yue2", 120)).toBe(3.5);
  });

  it("estimates round(minutesPerAudioMinute x expected minutes), at least 1", () => {
    expect(localCost("yue2", ENGINES, null)).toBe(6);
    expect(localCost("ace-step", ENGINES, null)).toBe(3);
    expect(localCost("ace-step", ENGINES, 300)).toBe(4);
    expect(localCost("ace-step", ENGINES, 30)).toBe(1);
  });

  it("has no estimate when the worker did not report the engine", () => {
    expect(localCost("yue2", {}, null)).toBeNull();
    expect(localCost("kie", ENGINES, null)).toBeNull();
  });
});

describe("labels", () => {
  it("names the engines", () => {
    expect(engineLabel("it", "kie")).toBe("Suno (kie)");
    expect(engineLabel("it", "ace-step")).toBe("ACE-Step · locale");
    expect(engineLabel("it", "yue2")).toBe("YuE2 · locale");
    expect(engineLabel("en", "yue2")).toBe("YuE2 · local");
  });

  it("pluralises minutes", () => {
    expect(minutesPhrase("it", 1)).toBe("1 minuto");
    expect(minutesPhrase("it", 6)).toBe("6 minuti");
    expect(minutesPhrase("en", 1)).toBe("1 minute");
    expect(minutesPhrase("en", 6)).toBe("6 minutes");
  });
});

describe("kieCredits and the cost of several songs", () => {
  it("counts every song of every language at 12 credits", () => {
    expect(songsTotal(1, 1)).toBe(1);
    expect(songsTotal(3, 2)).toBe(6);
    expect(kieCredits(6)).toBe(72);
  });
});

describe("engineControls", () => {
  it("shows every control for kie", () => {
    expect(engineControls("kie")).toEqual({
      model: true,
      tuning: true,
      duration: true,
      seed: false,
      expert: false,
    });
  });

  it("hides model and tuning for local engines, and duration for YuE2", () => {
    expect(engineControls("ace-step")).toEqual({
      model: false,
      tuning: false,
      duration: true,
      seed: true,
      expert: true,
    });
    expect(engineControls("yue2")).toEqual({
      model: false,
      tuning: false,
      duration: false,
      seed: true,
      expert: false,
    });
  });
});
