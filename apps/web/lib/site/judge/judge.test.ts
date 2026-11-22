import { describe, expect, it } from "vitest";
import { cleanRoom, wordsOf } from "./clean-room";
import { compareLayout, type LayoutRef } from "./likeness";
import { checkCss, checkTsx } from "./tokens";

// Shapes as in pages/home/layout-ref.json of the study (numbers from the 1440 and 390 rows).
const reference: LayoutRef = {
  slug: "home",
  route: "/",
  sections: ["Hero", "Three steps", "FAQ"],
  widths: {
    "1440": {
      pageHeight: 13320,
      sections: [
        {
          name: "Hero",
          present: true,
          y: 0,
          h: 1100,
          blocks: 1,
          contentLeft: 0,
          contentRight: 0,
          topInset: 0,
          bottomInset: 0,
          grid: null,
        },
        {
          name: "Three steps",
          present: true,
          y: 1983,
          h: 754,
          blocks: 1,
          contentLeft: 80,
          contentRight: 80,
          topInset: 96,
          bottomInset: 96,
          grid: {
            items: 3,
            perRow: 3,
            colGap: 8,
            rowGap: 8,
            itemW: 421,
            x: 80,
            w: 1280,
          },
        },
        {
          name: "FAQ",
          present: true,
          y: 10990,
          h: 553,
          blocks: 1,
          contentLeft: 80,
          contentRight: 80,
          topInset: 96,
          bottomInset: 96,
          grid: {
            items: 2,
            perRow: 2,
            colGap: 216,
            rowGap: 216,
            itemW: 354,
            x: 0,
            w: 1440,
          },
        },
      ],
    },
    "390": {
      pageHeight: 13869,
      sections: [
        {
          name: "Hero",
          present: true,
          y: 0,
          h: 828,
          blocks: 1,
          contentLeft: 0,
          contentRight: 0,
          topInset: 0,
          bottomInset: 0,
          grid: null,
        },
        {
          name: "Three steps",
          present: true,
          y: 1859,
          h: 1545,
          blocks: 4,
          contentLeft: 16,
          contentRight: 16,
          topInset: 0,
          bottomInset: 0,
          grid: null,
        },
        {
          name: "FAQ",
          present: true,
          y: 11080,
          h: 703,
          blocks: 1,
          contentLeft: 16,
          contentRight: 16,
          topInset: 96,
          bottomInset: 96,
          grid: {
            items: 2,
            perRow: 1,
            colGap: 40,
            rowGap: 40,
            itemW: 358,
            x: 0,
            w: 390,
          },
        },
      ],
    },
  },
};

const shift = (ref: LayoutRef, by: number): LayoutRef => {
  const copy: LayoutRef = structuredClone(ref);
  for (const w of Object.values(copy.widths))
    for (const s of w.sections) {
      s.contentLeft = (s.contentLeft ?? 0) + by;
      if (s.grid) s.grid.itemW += by;
    }
  return copy;
};

describe("likeness judge", () => {
  it("passes a layout within one spacing step of the reference", () => {
    const result = compareLayout(reference, shift(reference, 3), { stepPx: 4 });
    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(true);
    expect(result.worstSteps).toBe(1);
  });

  it("fails a layout two steps off, a wrong grid and a section out of order", () => {
    const bad = shift(reference, 8);
    bad.widths["1440"].sections[1].grid = {
      items: 3,
      perRow: 1,
      colGap: 8,
      rowGap: 8,
      itemW: 421,
      x: 80,
      w: 1280,
    };
    bad.widths["390"].sections[2].y = 10;
    const result = compareLayout(reference, bad, { stepPx: 4 });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain(
      "1440 #1 Three steps: 1 items per row, reference 3",
    );
    expect(result.failures).toContain(
      "1440 #0 Hero: contentLeft 8, reference 0 (2 steps off)",
    );
    expect(
      result.failures.some((f) => f.startsWith("390 #2 FAQ: out of order")),
    ).toBe(true);
  });

  it("fails when a width is missing or the section count differs", () => {
    const missing = structuredClone(reference);
    delete (missing.widths as Record<string, unknown>)["390"];
    missing.widths["1440"].sections.pop();
    const result = compareLayout(reference, missing, { stepPx: 4 });
    expect(result.failures).toEqual([
      "390: no measurement at this width",
      "1440: 2 sections, reference has 3",
    ]);
  });
});

describe("clean-room judge", () => {
  const captured = [
    "Make something people remember with one quiet click",
    "Get going",
    "Menu",
  ];
  it("passes our own words, with interface words on the allow list", () => {
    const result = cleanRoom({
      ours: [
        "Change a word. Hear it sung again in the same voice.",
        "Menu",
        "Start a song",
      ],
      reference: captured,
      allow: ["Menu"],
    });
    expect(result).toMatchObject({
      pass: true,
      sharedRuns: [],
      equalStrings: [],
    });
  });

  it("fails a shared run of six words and a whole string equal to the reference", () => {
    const result = cleanRoom({
      ours: [
        "Our app helps you make something people remember with one tap",
        "Make something people remember with ease",
        "Get going!",
        "Menu",
      ],
      reference: captured,
      allow: [],
    });
    expect(result.pass).toBe(false);
    // Five shared words in a row are allowed; six are not.
    expect(result.sharedRuns.map((h) => h.match)).toEqual([
      "make something people remember with one",
    ]);
    // One plain word is a word of the language; two words equal to the reference are a copy.
    expect(result.equalStrings.map((h) => h.match)).toEqual(["get going"]);
  });

  it("fails one word equal to the reference when the string is on the strict list (the header)", () => {
    const result = cleanRoom({
      ours: ["Menu", "Songbook"],
      reference: captured,
      strict: ["Menu", "Songbook"],
    });
    expect(result.equalStrings.map((h) => h.match)).toEqual(["menu"]);
  });

  it("reads words the same way in every language and with typographic apostrophes", () => {
    expect(wordsOf("Cambia una parola, l’AI la canta: È facile!")).toEqual([
      "cambia",
      "una",
      "parola",
      "l'ai",
      "la",
      "canta",
      "è",
      "facile",
    ]);
  });
});

describe("token judge", () => {
  it("passes site CSS that reads every value from a token", () => {
    const css = `
      @media (max-width: 47.9375em) { .site { --layout-padding-outer-x: var(--site-gutter-sm); } }
      @font-face { font-family: "X Fallback"; src: local("Arial"); size-adjust: 101%; }
      .hero { padding-block: var(--layout-padding-outer-y); color: var(--color-text-primary); inset: 0; width: 100%; }
      .rule { border: var(--border-width) solid var(--color-border); }`;
    expect(checkCss("site.css", css)).toEqual([]);
  });

  it("fails a hand-written colour, length and named colour", () => {
    const css =
      ".a { color: #fff; }\n.b { margin-top: 12px; }\n.c { background: rgb(0 0 0 / 0.5); }\n.d { color: white; }\n.e { --x: 2rem; }";
    expect(checkCss("site.css", css).map((v) => [v.line, v.rule])).toEqual([
      [1, "hex colour"],
      [2, "length written by hand"],
      [3, "colour function with literal numbers"],
      [4, "named colour"],
      [5, "length written by hand"],
    ]);
  });

  it("passes TSX built from components and fails raw elements, inline styles and arbitrary values", () => {
    const good = `<VStack gap={4}><Heading level={1}>Hi</Heading><svg viewBox="0 0 10 10" /></VStack>`;
    expect(checkTsx("page.tsx", good)).toEqual([]);
    const bad = `<div className="p-[13px]" style={{ color: "red" }}><p>Hi</p><Section maxWidth={1280} /></div>`;
    expect(checkTsx("page.tsx", bad).map((v) => v.rule)).toEqual([
      "inline style object",
      "arbitrary utility value",
      "size written by hand",
      "colour or length in a string",
      "raw <div>: use VStack, HStack, Grid or Card",
      'raw <p>: use Text as="p"',
    ]);
  });
});
