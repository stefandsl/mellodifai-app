import { describe, expect, it } from "vitest";
import { cleanRoom } from "./clean-room";
import { collectPageText } from "./page-text";

// A captured reference sentence (made up for the test, like the captures it stands for).
const captured = ["Every quiet room deserves a louder chorus tonight"];

describe("page text for the clean-room judge", () => {
  it("catches a copied sentence split by an inline element inside a long block", () => {
    const filler = "Our own words about songs and how they change. ".repeat(12);
    document.body.innerHTML = `<main><p>${filler}Every quiet room <em>deserves a louder</em> chorus tonight, ${filler}</p></main>`;
    expect(document.querySelector("p")?.textContent?.length).toBeGreaterThan(
      400,
    );
    const result = cleanRoom({
      ours: collectPageText(document),
      reference: captured,
    });
    expect(result.sharedRuns.map((h) => h.match)).toEqual([
      "every quiet room deserves a louder",
    ]);
  });

  it("passes our own words", () => {
    document.body.innerHTML =
      "<main><p>Change a word. <em>Hear it</em> sung.</p></main>";
    expect(
      cleanRoom({ ours: collectPageText(document), reference: captured }).pass,
    ).toBe(true);
  });
});
