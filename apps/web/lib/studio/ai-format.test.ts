import { describe, expect, it } from "vitest";
import {
  buildMessages,
  FORMAT_FIELDS,
  normalizeKey,
  parseFormatReply,
} from "./ai-format";

describe("normalizeKey", () => {
  it.each([
    ["D minor", "D minor"],
    ["d MINOR", "D minor"],
    ["E-flat major", "Eb major"],
    ["E flat major", "Eb major"],
    ["F sharp minor", "F# minor"],
    ["F# minor", "F# minor"],
    ["Bb major", "Bb major"],
    ["C major", "C major"],
  ])("reads %j as %j", (input, expected) => {
    expect(normalizeKey(input)).toBe(expected);
  });
  it.each(["H major", "C dorian", "Cb major", "E# minor", "", "minor", "A"])(
    "rejects %j",
    (input) => {
      expect(normalizeKey(input)).toBeNull();
    },
  );
});

describe("parseFormatReply", () => {
  it("reads the style and the three parameters", () => {
    expect(
      parseFormatReply(
        JSON.stringify({
          style: "synthwave, retro, dreamy female vocals",
          bpm: 108,
          key: "A minor",
          timeSignature: "4/4",
        }),
      ),
    ).toEqual({
      styles: "synthwave, retro, dreamy female vocals",
      bpm: 108,
      keyscale: "A minor",
      timeSignature: "4",
    });
  });
  it("accepts a reply wrapped in a code fence", () => {
    const text = `\`\`\`json\n${JSON.stringify({ style: "lo-fi", bpm: null, key: null, timeSignature: null })}\n\`\`\``;
    expect(parseFormatReply(text)).toEqual({ styles: "lo-fi" });
  });
  it("drops every parameter that is not usable, keeping the style", () => {
    expect(
      parseFormatReply(
        JSON.stringify({
          style: "ballad",
          bpm: 500,
          key: "H major",
          timeSignature: "5/4",
        }),
      ),
    ).toEqual({ styles: "ballad" });
    expect(
      parseFormatReply(
        JSON.stringify({ style: "waltz", bpm: "fast", timeSignature: "3/4" }),
      ),
    ).toEqual({ styles: "waltz", timeSignature: "3" });
  });
  it("rounds a fractional tempo and accepts 6/8", () => {
    expect(
      parseFormatReply(
        JSON.stringify({ style: "folk", bpm: 71.6, timeSignature: "6/8" }),
      ),
    ).toEqual({ styles: "folk", bpm: 72, timeSignature: "6" });
  });
  it("refuses a reply with no style, broken JSON, or privacy tags", () => {
    expect(parseFormatReply("not json")).toBeNull();
    expect(parseFormatReply(JSON.stringify({ bpm: 90 }))).toBeNull();
    expect(parseFormatReply(JSON.stringify({ style: "   " }))).toBeNull();
    expect(
      parseFormatReply(JSON.stringify({ style: "song for [PERSON_NAME]" })),
    ).toBeNull();
  });
  it("keeps the style within the form limit and free of em dashes", () => {
    const dash = String.fromCodePoint(0x2014);
    const parsed = parseFormatReply(
      JSON.stringify({ style: `pop ${dash} bright, ${"x".repeat(2000)}` }),
    );
    expect(parsed?.styles.length).toBeLessThanOrEqual(1000);
    expect(parsed?.styles).not.toContain(dash);
    expect(parsed?.styles.startsWith("pop - bright")).toBe(true);
  });
});

describe("buildMessages", () => {
  it("asks for JSON and carries only the styles text", () => {
    const [system, user] = buildMessages("slow jazz, rainy night");
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("JSON");
    for (const field of FORMAT_FIELDS) expect(system?.content).toContain(field);
    expect(user).toEqual({ role: "user", content: "slow jazz, rainy night" });
  });
});
