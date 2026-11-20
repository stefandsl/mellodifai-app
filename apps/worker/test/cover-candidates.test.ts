import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

// Cover candidates (PIANO-UNIFICATO M2b): thumbnail.py --covers picks three frames of the render and
// puts the title on them. These tests run the real script on synthetic frames, no model, no network.
const script = fileURLToPath(
  new URL("../src/stages/thumbnail.py", import.meta.url),
);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

// Ten frames, one every 2 s: f0001 opens the video (skipped), f0002 is the sharpest but lyrics are
// sung over it, f0004 repeats f0003's scene, f0005 is blurred, f0007 is almost black, f0009 and
// f0010 are flat.
const FRAMES = `
import sys
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]
def checker(cell, a, b, light=None):
    im = Image.new("RGB", (1280, 720), a)
    d = ImageDraw.Draw(im)
    for y in range(0, 720, cell):
        for x in range(0, 1280, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=b)
    return im
frames = [
    checker(8, "white", "black"),
    checker(8, "white", "navy"),
    checker(16, "#d33", "white"),
    checker(16, "#d33", "white"),
    checker(16, "#3a3", "white").filter(ImageFilter.GaussianBlur(12)),
    checker(32, "#24c", "#fd2"),
    Image.new("RGB", (1280, 720), "#050505"),
    checker(24, "#0a6", "#111"),
    Image.new("RGB", (1280, 720), "#888"),
    Image.new("RGB", (1280, 720), "#999"),
]
for i, im in enumerate(frames, start=1):
    im.save(f"{out}/f{i:04d}.jpg", quality=92)
`;

async function frames(make = FRAMES) {
  const dir = await mkdtemp(join(tmpdir(), "cover-frames-"));
  dirs.push(dir);
  const made = spawnSync("python", ["-X", "utf8", "-c", make, dir], {
    encoding: "utf8",
  });
  expect(made.status, made.stderr).toBe(0);
  await writeFile(
    join(dir, "song.srt"),
    "1\n00:00:01,500 --> 00:00:02,500\nla la la\n",
  );
  return dir;
}

type Cover = {
  id: string;
  file: string;
  frame: string;
  frame_sec: number;
  lyric_free: boolean;
  fonts: string[];
  lines: string[];
  phone: { min_line_px: number; contrast: number };
};
function covers(dir: string, title: string, lang: string, tag = "a") {
  const outputs = [1, 2, 3].map((n) => join(dir, `${tag}-cover-${n}.png`));
  const run = spawnSync(
    "python",
    [
      "-X",
      "utf8",
      script,
      `--title=${title}`,
      "--lang",
      lang,
      "--frames",
      dir,
      "--step",
      "2",
      "--srt",
      join(dir, "song.srt"),
      "--manifest",
      join(dir, `${tag}.json`),
      "--covers",
      ...outputs,
    ],
    { encoding: "utf8" },
  );
  expect(run.status, run.stderr).toBe(0);
  return {
    outputs,
    covers: (JSON.parse(run.stdout) as { covers: Cover[] }).covers,
  };
}

it("picks the same three frames every time: lyric-free, sharp, distinct scenes", async () => {
  const dir = await frames();
  const first = covers(dir, "Luce sul porto", "it", "a");
  const second = covers(dir, "Luce sul porto", "it", "b");
  expect(first.covers.map((c) => c.frame)).toEqual([
    "f0003.jpg",
    "f0006.jpg",
    "f0008.jpg",
  ]);
  expect(second.covers.map((c) => c.frame)).toEqual(
    first.covers.map((c) => c.frame),
  );
  expect(first.covers.map((c) => c.id)).toEqual([
    "cover-1",
    "cover-2",
    "cover-3",
  ]);
  expect(first.covers.every((c) => c.lyric_free)).toBe(true);
  // Same input, same pixels.
  for (const [i, file] of first.outputs.entries())
    expect(
      Buffer.compare(
        await readFile(file),
        await readFile(second.outputs[i] ?? ""),
      ),
    ).toBe(0);
});

// An independent ruler: the cover drawn on a flat light frame, scaled to 168x94 as YouTube's phone
// list shows it. Text pixels are the white ones; each line's ink height is a run of rows with text,
// the contrast is WCAG's between the text and the darkened frame around it.
const RULER = `
import json, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("L").resize((168, 94), Image.Resampling.LANCZOS)
w, h = im.size
px = im.load()
lum = lambda v: (v / 255) / 12.92 if v / 255 <= 0.04045 else ((v / 255 + 0.055) / 1.055) ** 2.4
rows = [any(px[x, y] >= 200 for x in range(w)) for y in range(h)]
runs, start = [], None
for y, on in enumerate(rows + [False]):
    if on and start is None: start = y
    if not on and start is not None: runs.append(y - start); start = None
cols = [x for x in range(w) if any(px[x, y] >= 200 for y in range(h))]
ys = [y for y in range(h) if rows[y]]
text = max(px[x, y] for x in range(w) for y in range(h))
back = px[2, 2]
print(json.dumps({"runs": runs, "box": [min(cols), min(ys), max(cols) + 1, max(ys) + 1],
  "contrast": (lum(text) + 0.05) / (lum(back) + 0.05)}))
`;

it.each([
  ["Luce sul porto", "it"],
  ["A very long song title about the dawn after the last autumn storm", "en"],
  ["夜明けの港で君を待つ", "ja"],
  ["Пепел и снег над старым городом", "ru"],
])(
  "keeps %s legible at 168x94, measured on the scaled image",
  async (title, lang) => {
    const dir = await frames(`
import sys
from PIL import Image
for i in range(1, 11):
    Image.new("RGB", (1280, 720), "#d8d8d8").save(f"{sys.argv[1]}/f{i:04d}.jpg", quality=95)
`);
    const made = covers(dir, title, lang);
    const lines = made.covers[0]?.lines.length ?? 0;
    expect(lines).toBeGreaterThan(0);
    const ruler = spawnSync(
      "python",
      ["-X", "utf8", "-c", RULER, made.outputs[0] ?? ""],
      { encoding: "utf8" },
    );
    expect(ruler.status, ruler.stderr).toBe(0);
    const seen = JSON.parse(ruler.stdout) as {
      runs: number[];
      box: number[];
      contrast: number;
    };
    // One ink run per line, each at least 8 px tall on a 168x94 phone thumbnail.
    expect(seen.runs.length).toBe(lines);
    expect(Math.min(...seen.runs)).toBeGreaterThanOrEqual(8);
    expect(seen.contrast).toBeGreaterThanOrEqual(4.5);
    // Inside the 5 percent safe margins.
    expect(seen.box[0]).toBeGreaterThanOrEqual(8);
    expect(seen.box[1]).toBeGreaterThanOrEqual(4);
    expect(seen.box[2]).toBeLessThanOrEqual(160);
    expect(seen.box[3]).toBeLessThanOrEqual(90);
  },
);

it("renders Japanese and Cyrillic titles with fonts that have their glyphs", async () => {
  const dir = await frames();
  const ja = covers(dir, "夜明けの港で君を待つ", "ja", "ja").covers[0];
  const ru = covers(dir, "Пепел и снег", "ru", "ru").covers[0];
  if (process.platform === "win32") {
    expect(ja?.fonts).toEqual(["meiryob.ttc"]);
    expect(ru?.fonts).toEqual(["arialbd.ttf"]);
  } else {
    expect(ja?.fonts).not.toContain("DejaVuSans-Bold.ttf");
    expect(ru?.fonts).toEqual(["DejaVuSans-Bold.ttf"]);
  }
});

it("cuts a title too long for three readable lines with an ellipsis instead of shrinking it", async () => {
  const dir = await frames();
  const long =
    "Una canzone lunghissima sulla notte in cui il porto si svuota e restano solo le luci e il mare";
  const cover = covers(dir, long, "it").covers[0];
  expect(cover?.lines.length).toBeLessThanOrEqual(3);
  expect(cover?.lines.at(-1)).toMatch(/…$/u);
  expect(cover?.phone.min_line_px).toBeGreaterThanOrEqual(8);
});
