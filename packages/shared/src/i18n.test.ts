import { expect, it } from "vitest";
import { DICTIONARY } from "./i18n.js";

it("uses real accents in every Italian value", () => {
  for (const [key, value] of Object.entries(DICTIONARY.it))
    expect(value, key).not.toMatch(/[aeiou]'(\s|$)/u);
});
