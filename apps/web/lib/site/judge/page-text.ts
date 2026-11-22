// The strings of a rendered page that the clean-room judge compares with the reference.
// Runs in the browser (Playwright page.evaluate) and in jsdom; self-contained on purpose.
export function collectPageText(root?: ParentNode): string[] {
  root = root ?? document;
  const out: string[] = [];
  for (const el of root.querySelectorAll("body *")) {
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join(" ")
      .trim();
    if (own) out.push(own);
    // The whole rendered text of each element, inline elements joined, at any length: a copied
    // sentence split by <em> or <a> inside a long paragraph is still one run of words here.
    const t = el.textContent?.replace(/\s+/gu, " ").trim();
    if (t) out.push(t);
    for (const a of ["aria-label", "alt", "title", "placeholder"]) {
      const v = el.getAttribute(a);
      if (v) out.push(v);
    }
  }
  const doc =
    (root as Document).title === undefined ? document : (root as Document);
  out.push(
    doc.title,
    doc.querySelector('meta[name="description"]')?.getAttribute("content") ??
      "",
  );
  return out;
}
