// Token judge for the public site files: no colour, size or spacing written by hand where a
// token exists, and no raw element where an Astryx component exists. Exceptions are written in
// SITE_ALLOW below, each with its reason.

export type TokenViolation = { file: string; line: number; rule: string; text: string };

// Raw elements and the Astryx component to use instead.
export const COMPONENT_FOR: Record<string, string> = {
  div: "VStack, HStack, Grid or Card",
  section: "VStack as=\"section\"",
  span: "Text",
  p: "Text as=\"p\"",
  h1: "Heading",
  h2: "Heading",
  h3: "Heading",
  h4: "Heading",
  h5: "Heading",
  h6: "Heading",
  button: "Button, IconButton or ToggleButton",
  a: "Link or Button href",
  input: "TextInput",
  hr: "Divider",
  kbd: "Kbd",
  img: "Thumbnail or an svg drawing",
  label: "Field",
  table: "Table",
};

export const SITE_ALLOW = {
  // Raw elements that are allowed, with the reason.
  elements: {
    svg: "drawings (waveforms, record sleeves, the wordmark): Astryx has no drawing component",
    audio: "the sample player: Astryx has no audio element",
    dialog: "the full-screen menu: MobileNav is a side drawer capped at 85% of the width",
  } as Record<string, string>,
  // Literal values that are allowed in CSS declarations.
  values: ["0", "1px solid transparent"] as string[],
};

const COLOUR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\()[^)]*\d/giu;
const HEX = /(?<![\w&-])#[0-9a-f]{3,8}\b/giu;
const LENGTH =
  /(?<![\w.-])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|vh|vw|svh|dvh|lvh|vmin|vmax|ch|ex|cm|mm|in|pt|pc|cqi|cqw|cqh)\b/giu;
const NAMED =
  /(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink)(?![\w-])/giu;

const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

function stripCssComments(source: string) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//gu, (m) => m.replaceAll(/[^\n]/gu, " "));
}

/** CSS of the site: every declaration value must come from a token. */
export function checkCss(file: string, raw: string): TokenViolation[] {
  const blank = (m: string) => m.replaceAll(/[^\n{]/gu, " ");
  const source = stripCssComments(raw)
    // A media, container or supports condition cannot read a custom property: skip preludes.
    .replaceAll(/@(?:media|container|supports)[^{;]*\{/gu, blank)
    // Font faces describe a font file (its metrics), not the page.
    .replaceAll(/@font-face\s*\{[^}]*\}/gu, (m) => m.replaceAll(/[^\n]/gu, " "));
  const out: TokenViolation[] = [];
  const decl = /(^|[{;\s])([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/gu;
  for (const m of source.matchAll(decl)) {
    const name = m[2];
    const value = m[3].trim();
    const at = (m.index ?? 0) + m[1].length;
    if (SITE_ALLOW.values.includes(value)) continue;
    const scan = value.replaceAll(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/gu, "var()");
    const rules: [RegExp, string][] = [
      [HEX, "hex colour"],
      [COLOUR_FN, "colour function with literal numbers"],
      [NAMED, "named colour"],
      [LENGTH, "length written by hand"],
    ];
    for (const [re, rule] of rules) {
      re.lastIndex = 0;
      if (re.test(scan)) {
        out.push({ file, line: lineOf(raw, at), rule, text: `${name}: ${value}`.slice(0, 120) });
        break;
      }
    }
  }
  return out;
}

/** TSX of the site: no inline style objects, no arbitrary utility values, no raw elements. */
export function checkTsx(file: string, raw: string): TokenViolation[] {
  const source = raw.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, (m) => m.replaceAll(/[^\n]/gu, " "));
  const out: TokenViolation[] = [];
  const push = (index: number, rule: string, text: string) =>
    out.push({ file, line: lineOf(raw, index), rule, text: text.slice(0, 120) });
  for (const m of source.matchAll(/\bstyle=\{\{/gu)) push(m.index ?? 0, "inline style object", m[0]);
  for (const m of source.matchAll(/className=["{`][^"}`]*\b[\w:-]+-\[[^\]]+\]/gu))
    push(m.index ?? 0, "arbitrary utility value", m[0]);
  for (const m of source.matchAll(/\b(?:width|height|maxWidth|minWidth|minHeight|maxHeight|size)=\{\s*\d/gu))
    push(m.index ?? 0, "size written by hand", m[0]);
  for (const m of source.matchAll(/["'`][^"'`\n]*?(?:#[0-9a-f]{3,8}\b|\d+(?:\.\d+)?(?:px|rem|em)\b)[^"'`\n]*["'`]/giu))
    push(m.index ?? 0, "colour or length in a string", m[0]);
  for (const m of source.matchAll(/<([a-z][a-z0-9]*)\b/gu)) {
    const tag = m[1];
    if (COMPONENT_FOR[tag] && !SITE_ALLOW.elements[tag])
      push(m.index ?? 0, `raw <${tag}>: use ${COMPONENT_FOR[tag]}`, m[0]);
  }
  return out;
}
