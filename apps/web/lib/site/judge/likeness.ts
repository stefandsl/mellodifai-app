// Likeness judge: the measured layout of one of our pages against the layout reference of the
// study (E:/mellodifai/research/2026-11-20/cardboard/pages/<slug>/layout-ref.json).
// It compares structure only: section order, content column, insets and the main grid.
// Text, colour, font and section height are not compared (our words differ, so heights differ).
// The tolerance is a number of steps of the token spacing scale (one step = --spacing-1).

export type LayoutGrid = {
  items: number;
  perRow: number;
  colGap: number;
  rowGap: number;
  itemW: number;
  x: number;
  w: number;
};

export type LayoutSection = {
  name: string;
  present: boolean;
  y?: number;
  h?: number;
  blocks?: number;
  contentLeft?: number;
  contentRight?: number;
  topInset?: number;
  bottomInset?: number;
  grid?: LayoutGrid | null;
};

export type LayoutRef = {
  slug?: string;
  route?: string;
  sections: string[];
  widths: Record<string, { pageHeight?: number; sections: LayoutSection[] }>;
};

export type LikenessResult = {
  pass: boolean;
  tolerancePx: number;
  checked: number;
  failures: string[];
  worstSteps: number;
};

const INSETS = [
  "contentLeft",
  "contentRight",
  "topInset",
  "bottomInset",
] as const;
const GRID = ["colGap", "rowGap", "itemW", "x", "w"] as const;

export function compareLayout(
  reference: LayoutRef,
  candidate: LayoutRef,
  options: { stepPx: number; steps?: number },
): LikenessResult {
  const steps = options.steps ?? 1;
  if (!(options.stepPx > 0))
    throw new Error("stepPx must be a positive number");
  const tolerancePx = steps * options.stepPx;
  const failures: string[] = [];
  let checked = 0;
  let worstSteps = 0;
  const value = (id: string, field: string, want = 0, got = 0) => {
    checked++;
    const off = Math.abs(want - got);
    const inSteps = Math.ceil(off / options.stepPx - 1e-9);
    worstSteps = Math.max(worstSteps, inSteps);
    if (off > tolerancePx)
      failures.push(
        `${id}: ${field} ${got}, reference ${want} (${inSteps} steps off)`,
      );
  };
  for (const width of Object.keys(reference.widths)) {
    const want = reference.widths[width].sections;
    const got = candidate.widths[width]?.sections;
    if (!got) {
      failures.push(`${width}: no measurement at this width`);
      continue;
    }
    if (want.length !== got.length) {
      failures.push(
        `${width}: ${got.length} sections, reference has ${want.length}`,
      );
      continue;
    }
    let lastY = Number.NEGATIVE_INFINITY;
    want.forEach((ref, i) => {
      const cand = got[i];
      const id = `${width} #${i} ${ref.name.slice(0, 40)}`;
      if (ref.present !== cand.present) {
        failures.push(
          `${id}: present ${cand.present}, reference ${ref.present}`,
        );
        return;
      }
      if (!ref.present) return;
      if (typeof cand.y === "number") {
        if (cand.y < lastY)
          failures.push(
            `${id}: out of order (y ${cand.y} above the section before it)`,
          );
        lastY = cand.y;
      }
      for (const field of INSETS) value(id, field, ref[field], cand[field]);
      if (!!ref.grid !== !!cand.grid) {
        failures.push(
          `${id}: grid ${cand.grid ? "present" : "missing"}, reference ${ref.grid ? "present" : "missing"}`,
        );
        return;
      }
      if (!ref.grid || !cand.grid) return;
      checked++;
      if (ref.grid.perRow !== cand.grid.perRow)
        failures.push(
          `${id}: ${cand.grid.perRow} items per row, reference ${ref.grid.perRow}`,
        );
      for (const field of GRID)
        value(id, `grid.${field}`, ref.grid[field], cand.grid[field]);
    });
  }
  return {
    pass: failures.length === 0,
    tolerancePx,
    checked,
    failures,
    worstSteps,
  };
}

/**
 * Runs in the browser (Playwright page.evaluate). Our pages mark their structure:
 * - `data-ref-section="N"`: a block of reference section N (a section may have several blocks);
 * - `data-ref-content`: the content column inside a block (its content box is the column);
 * - `data-ref-grid`: the main grid of the section; `data-ref-grid-widths="1440,1024"` limits the
 *   widths at which the reference names a main grid for that section.
 * It is self-contained on purpose: Playwright serialises the function source.
 */
export function measureLayoutInPage(input: { names: string[]; width: number }) {
  const px = (v: string) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const R = Math.round;
  const doc = document.documentElement;
  const sy = window.scrollY;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      getComputedStyle(el).visibility !== "hidden"
    );
  };
  const sections = input.names.map((name, i) => {
    // The shared footer carries data-ref-footer and stands for the section named "Footer".
    const selector = name.startsWith("Footer")
      ? `[data-ref-section="${i}"], [data-ref-footer]`
      : `[data-ref-section="${i}"]`;
    const blocks = [...document.querySelectorAll(selector)].filter(visible);
    if (!blocks.length) return { name, present: false };
    const rects = blocks.map((b) => b.getBoundingClientRect());
    const top = Math.min(...rects.map((r) => r.top)) + sy;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + sy;
    const cols = blocks.map((b) => {
      const c =
        (b.matches("[data-ref-content]")
          ? b
          : b.querySelector("[data-ref-content]")) ?? b;
      const r = c.getBoundingClientRect();
      const s = getComputedStyle(c);
      return [r.left + px(s.paddingLeft), r.right - px(s.paddingRight)];
    });
    const left = Math.max(0, Math.min(...cols.map((c) => c[0])));
    const right = Math.min(input.width, Math.max(...cols.map((c) => c[1])));
    let grid = null;
    for (const b of blocks) {
      const g = b.matches("[data-ref-grid]")
        ? b
        : b.querySelector("[data-ref-grid]");
      if (!g || !visible(g)) continue;
      const only = g.getAttribute("data-ref-grid-widths");
      if (only && !only.split(",").map(Number).includes(input.width)) continue;
      const kids = [...g.children].filter(visible);
      if (kids.length < 2) continue;
      const boxes = kids.map((k) => k.getBoundingClientRect());
      const s = getComputedStyle(g);
      const gap = (v: string) => (v === "normal" ? 0 : px(v));
      const gr = g.getBoundingClientRect();
      grid = {
        items: kids.length,
        perRow: boxes.filter((b) => Math.abs(b.top - boxes[0].top) <= 4).length,
        colGap: R(gap(s.columnGap)),
        rowGap: R(gap(s.rowGap)),
        itemW: R(boxes[0].width),
        x: R(gr.left),
        w: R(gr.width),
      };
      break;
    }
    const first = getComputedStyle(blocks[0]);
    const last = getComputedStyle(blocks[blocks.length - 1]);
    return {
      name,
      present: true,
      y: R(top),
      h: R(bottom - top),
      blocks: blocks.length,
      contentLeft: R(left),
      contentRight: R(input.width - right),
      topInset: R(px(first.paddingTop)),
      bottomInset: R(px(last.paddingBottom)),
      grid,
    };
  });
  return { pageHeight: R(doc.scrollHeight), sections };
}
