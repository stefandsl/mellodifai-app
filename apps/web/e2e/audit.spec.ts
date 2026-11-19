// Functional audit of the studio (PIANO-UNIFICATO.md, phase F1). FROZEN evaluator of the
// autoresearch run "nov14-f1": do not edit it during the loop (ops/autoresearch/eval-f1.ts).
//
// It runs only with MDF_AUDIT=1 (plain `pnpm e2e` skips it). It never fails on a defect: every
// defect is appended as one JSON line to MDF_AUDIT_OUT and the scorer counts them. A test fails
// only when the audit itself cannot run (seeding, sign-in).
//
// Categories, per page and per viewport (1440x900, 1360x600, 390x844):
//   a  a visible enabled button or link whose click has no observable effect within 3 s
//      (no navigation, no request, no DOM change, no dialog, no popup, no download).
//   b  a visible interactive element whose box intersects another interactive element or a
//      visible text box (by more than 2 px on both axes), neither containing the other.
//   c  a song card (article named after a fixture song) with no visible cover: no background
//      image, no loaded <img>, no video frame; or a cover image URL that does not load.
//   d  a play control ("Riproduci..." / "Ascolta...") after whose click no media element plays.
//   e  a console error, an uncaught page error or a response with status >= 500 while the page
//      loads and settles (2 s).
//   f1 one per owner request of F1 with a UI whose end-to-end check fails.
//
// Intentional overlays and exclusions (not defects):
//   - Elements are compared only within the same layer: the nearest position:fixed or
//     position:sticky ancestor (the sidebar, the player bar, top bars, toasts, dialogs) or the
//     page. Content scrolling under a fixed bar is not an overlap.
//   - Text inside an aria-hidden subtree (cover titles and language tags drawn on artwork) and
//     boxes under 2 px (screen-reader-only text) are not text for (b).
//   - (a) skips: links to the page already shown or to "#", elements inside a closed or
//     aria-hidden subtree, the Next.js dev overlay (shadow DOM, never queried). Controls that
//     differ only by a fixture song's title or by digits are one control (tested once per page
//     and viewport); at most 40 distinct controls per page and viewport.
//   - During the (a) sweep every non-GET request is counted as an effect and then aborted, so
//     the sweep never changes data (no sign-out, no deletion, no publication). Errors caused by
//     those aborts are not counted in (e).
//   - Chrome (channel "chrome") plays the H.264 fixtures as the owner's browser does.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  getAdminId,
  serviceClient,
  signIn,
  startFakeWorker,
  stopWorker,
} from "./support";

const AUDIT = process.env.MDF_AUDIT === "1";
const ROOT = process.env.MELLODIFAI_ROOT ?? process.env.RUNNER_TEMP ?? "";
const OUT =
  process.env.MDF_AUDIT_OUT ?? join(ROOT, "test-results/audit/defects.jsonl");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1360, height: 600 },
  { width: 390, height: 844 },
] as const;
const TAG = `Audit ${Date.now().toString(36)}`;
const EFFECT_MS = 3000;
const MAX_CONTROLS = 40;

test.skip(!AUDIT, "The functional audit runs only through eval-f1.ts");
test.use({ channel: "chrome" });

type Category = "a" | "b" | "c" | "d" | "e" | "f1";
function defect(
  category: Category,
  page: string,
  viewport: string,
  detail: string,
) {
  mkdirSync(dirname(OUT), { recursive: true });
  appendFileSync(
    OUT,
    `${JSON.stringify({ category, page, viewport, detail: detail.slice(0, 300) })}\n`,
  );
}

// ---------- fixtures ----------

function wav(seconds: number) {
  const samples = seconds * 8000;
  const audio = Buffer.alloc(44 + samples * 2);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    audio.writeInt16LE(Math.round(Math.sin(i / 4) * 8000), 44 + i * 2);
  return audio;
}

function media() {
  const dir = join(ROOT, "tmp/audit-media");
  mkdirSync(dir, { recursive: true });
  const video = join(dir, "video.mp4");
  const cover = join(dir, "cover.png");
  const ff = (args: string[]) =>
    execFileSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      {
        windowsHide: true,
      },
    );
  ff([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x8a2be2:s=640x360:r=25:d=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=30",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    video,
  ]);
  ff([
    "-f",
    "lavfi",
    "-i",
    "color=c=0xe0115f:s=512x512",
    "-frames:v",
    "1",
    "-update",
    "1",
    cover,
  ]);
  return { video: readFileSync(video), cover: readFileSync(cover) };
}

const LYRICS = [
  "[Strofa]",
  "La luna splende sul porto",
  "Cammino piano nella notte",
  "",
  "[Ritornello]",
  "Canto forte la mia strada",
  "e la notte mi risponde",
].join("\n");
const TIMING = {
  source: "whisper",
  lines: [
    { text: "La luna splende sul porto", start: 0.5, end: 3.5 },
    { text: "Cammino piano nella notte", start: 4, end: 7 },
    { text: "Canto forte la mia strada", start: 7.5, end: 10 },
    { text: "e la notte mi risponde", start: 10.2, end: 11.8 },
  ],
};
const PACK = {
  title: "",
  lyrics: LYRICS,
  style: "Pop luminoso",
  exclude: "",
  settings: {
    model: "V6",
    vocalGender: "f",
    styleWeight: 0.7,
    weirdness: 0.35,
    variety: 1,
    duration: 60,
  },
  displayMap: {},
  l10n: {},
};

type Song = {
  key: string;
  status: string;
  takes: number;
  cover?: boolean;
  video?: boolean;
  chosen?: boolean;
  job?: "queued" | "running" | "done" | "failed" | "cancelled";
  settings?: Record<string, unknown>;
};
// Songs with and without video, with and without cover, one in each version status and one
// job in each job status.
const SONGS: Song[] = [
  {
    key: "video e copertina",
    status: "approved",
    takes: 1,
    cover: true,
    video: true,
    chosen: true,
    job: "done",
  },
  {
    key: "copertina senza video",
    status: "audio_ready",
    takes: 1,
    cover: true,
    chosen: true,
  },
  {
    key: "video senza copertina",
    status: "approved",
    takes: 1,
    video: true,
    chosen: true,
  },
  {
    key: "senza video e copertina",
    status: "audio_ready",
    takes: 1,
    chosen: true,
  },
  { key: "analisi", status: "analysing", takes: 0 },
  { key: "bozza", status: "drafting", takes: 0, job: "cancelled" },
  { key: "testo pronto", status: "lyrics_review", takes: 0 },
  { key: "in coda", status: "song_queued", takes: 0, job: "queued" },
  { key: "take da scegliere", status: "takes_review", takes: 2 },
  {
    key: "in produzione",
    status: "producing",
    takes: 1,
    chosen: true,
    job: "running",
  },
  {
    key: "video da rivedere",
    status: "video_review",
    takes: 1,
    video: true,
    chosen: true,
  },
  {
    key: "in pubblicazione",
    status: "publishing",
    takes: 1,
    video: true,
    cover: true,
    chosen: true,
  },
  {
    key: "pubblicata",
    status: "published",
    takes: 1,
    video: true,
    cover: true,
    chosen: true,
  },
  { key: "fallita", status: "failed", takes: 1, chosen: true, job: "failed" },
];
const titleOf = (song: Song) => `${TAG} ${song.key}`;

type Seeded = {
  owner: string;
  versions: Map<string, { id: string; projectId: string }>;
  playlistId: string;
};

async function must<T>(
  query: PromiseLike<{ data: T; error: unknown }>,
): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error || data === null || data === undefined)
    throw error ?? new Error("Fixture write failed");
  return data;
}

async function seed(): Promise<Seeded> {
  const db = serviceClient();
  const owner = await getAdminId();
  // An interrupted earlier audit may have left its playlists (projects go in global setup).
  await db
    .from("playlists")
    .delete()
    .eq("owner_id", owner)
    .like("name", "Audit %");
  const files = media();
  const audio = wav(12);
  const versions = new Map<string, { id: string; projectId: string }>();
  for (const song of SONGS) {
    const title = titleOf(song);
    const project = await must(
      db
        .from("projects")
        .insert({
          owner_id: owner,
          topic: title,
          song_settings: song.settings ?? {},
        })
        .select("id")
        .single(),
    );
    const version = await must(
      db
        .from("versions")
        .insert({
          owner_id: owner,
          project_id: project.id,
          lang: "it",
          status: song.status,
          display_title: title,
          lyric_pack: { ...PACK, title },
          lyric_timing: song.takes ? TIMING : null,
        })
        .select("id")
        .single(),
    );
    versions.set(song.key, { id: version.id, projectId: project.id });
    const base = `previews/${owner}/${project.id}/it`;
    let chosen: string | null = null;
    for (let n = 1; n <= song.takes; n++) {
      const path = `${base}/take-${n}.wav`;
      const up = await db.storage
        .from("previews")
        .upload(path, audio, { contentType: "audio/wav", upsert: true });
      if (up.error) throw up.error;
      let coverPath: string | null = null;
      if (song.cover) {
        coverPath = `${base}/cover-${n}.png`;
        const c = await db.storage
          .from("previews")
          .upload(coverPath, files.cover, {
            contentType: "image/png",
            upsert: true,
          });
        if (c.error) throw c.error;
      }
      const take = await must(
        db
          .from("takes")
          .insert({
            owner_id: owner,
            version_id: version.id,
            generation: 1,
            take_number: n,
            audio_preview_path: path,
            cover_path: coverPath,
            lyric_timing: TIMING,
          })
          .select("id")
          .single(),
      );
      if (n === 1) chosen = take.id;
    }
    if (song.chosen && chosen)
      await must(
        db
          .from("versions")
          .update({ chosen_take_id: chosen })
          .eq("id", version.id)
          .select("id"),
      );
    if (song.video) {
      const path = `${base}/render-1/master.mp4`;
      const up = await db.storage
        .from("previews")
        .upload(path, files.video, { contentType: "video/mp4", upsert: true });
      if (up.error) throw up.error;
      await must(
        db
          .from("renders")
          .insert({
            owner_id: owner,
            version_id: version.id,
            kind: "master",
            path,
            preview_path: path,
            render_attempt: 1,
          })
          .select("id"),
      );
    }
    if (song.job)
      await must(
        db
          .from("jobs")
          .insert({
            owner_id: owner,
            version_id: version.id,
            stage: song.job === "queued" ? "generate_song" : "art",
            status: song.job,
            idempotency_key: `${TAG}:${song.key}`,
            not_before:
              song.job === "queued"
                ? new Date(Date.now() + 864e5).toISOString()
                : null,
            error:
              song.job === "failed" ? "Audit: copertina non generata" : null,
            started_at: song.job === "queued" ? null : new Date().toISOString(),
            finished_at:
              song.job === "running" || song.job === "queued"
                ? null
                : new Date().toISOString(),
          })
          .select("id"),
      );
  }
  const playlist = await must(
    db
      .from("playlists")
      .insert({ owner_id: owner, name: `${TAG} playlist` })
      .select("id")
      .single(),
  );
  let position = 1;
  for (const key of [
    "video e copertina",
    "copertina senza video",
    "senza video e copertina",
  ]) {
    const v = versions.get(key);
    if (!v) continue;
    await must(
      db
        .from("playlist_items")
        .insert({
          playlist_id: playlist.id,
          version_id: v.id,
          position: position++,
        })
        .select("playlist_id"),
    );
  }
  return { owner, versions, playlistId: playlist.id };
}

async function unseed(seeded: Seeded) {
  const db = serviceClient();
  await db.from("playlists").delete().eq("id", seeded.playlistId);
  const ids = [...seeded.versions.values()].map((v) => v.projectId);
  if (ids.length) await db.from("projects").delete().in("id", ids);
}

// ---------- in-page probes ----------

const INIT = () => {
  const w = window as unknown as {
    __mut: number;
    __media: Set<HTMLMediaElement>;
    __webaudio: number;
  };
  w.__mut = 0;
  w.__media = new Set();
  w.__webaudio = 0;
  // The audio editor plays through Web Audio, not a media element.
  const startSource = AudioScheduledSourceNode.prototype.start;
  AudioScheduledSourceNode.prototype.start = function start(
    this: AudioScheduledSourceNode,
    ...args: Parameters<AudioScheduledSourceNode["start"]>
  ) {
    if (this.context.state !== "suspended") w.__webaudio++;
    return startSource.apply(this, args);
  };
  const original = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
    w.__media.add(this);
    return original.call(this);
  };
  const start = () =>
    new MutationObserver((records) => {
      w.__mut += records.length;
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
};

// Runs in the page: candidate controls, their keys, and marks the n-th instance of one key.
const SCAN = ({
  titles,
  mark,
}: {
  titles: string[];
  mark: string | null;
}): { keys: string[]; marked: boolean } => {
  const SELECTOR =
    'button, a[href], summary, input[type="button"], input[type="submit"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="switch"], [role="radio"], [role="checkbox"], [role="option"]';
  for (const el of document.querySelectorAll("[data-audit-target]"))
    el.removeAttribute("data-audit-target");
  const name = (el: Element) => {
    const label = el.getAttribute("aria-label");
    if (label) return label;
    const by = el.getAttribute("aria-labelledby");
    if (by)
      return by
        .split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    // biome-ignore lint/performance/useDomNodeTextContent: the audit reads the rendered text, which skips hidden nodes
    const text = (el as HTMLElement).innerText?.trim();
    if (text) return text;
    return el.getAttribute("title") ?? el.getAttribute("href") ?? "";
  };
  const norm = (value: string) => {
    let out = value.replace(/\s+/gu, " ").trim();
    for (const title of titles) out = out.split(title).join("<song>");
    return out.replace(/\d+/gu, "#").slice(0, 120);
  };
  const keys: string[] = [];
  let marked = false;
  for (const el of document.querySelectorAll(SELECTOR)) {
    const html = el as HTMLElement;
    if (html.closest("[aria-hidden='true'], [inert]")) continue;
    // Choosing the option already chosen changes nothing, like a link to the page shown.
    if (
      html.getAttribute("aria-checked") === "true" ||
      html.getAttribute("aria-selected") === "true" ||
      (html instanceof HTMLInputElement && html.checked)
    )
      continue;
    if (
      (html as HTMLButtonElement).disabled ||
      html.getAttribute("aria-disabled") === "true"
    )
      continue;
    const rect = html.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (
      !html.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
      continue;
    if (html instanceof HTMLAnchorElement) {
      const href = html.getAttribute("href") ?? "";
      if (href === "#" || href === "") continue;
      const target = new URL(html.href, location.href);
      if (
        target.origin === location.origin &&
        target.pathname + target.search === location.pathname + location.search
      )
        continue;
    }
    const role = html.getAttribute("role") ?? html.tagName.toLowerCase();
    const key = `${role}:${norm(name(html))}`;
    if (keys.includes(key)) continue;
    keys.push(key);
    if (mark === key && !marked) {
      html.setAttribute("data-audit-target", "1");
      marked = true;
    }
  }
  return { keys, marked };
};

// Runs in the page: overlaps of interactive elements with other interactive elements or text.
const OVERLAPS = (titles: string[]): string[] => {
  const SELECTOR =
    'button, a[href], summary, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="switch"], [role="radio"], [role="checkbox"], [role="slider"], [role="combobox"], [role="textbox"]';
  type Box = { left: number; top: number; right: number; bottom: number };
  const clip = (el: Element, box: Box): Box | null => {
    // A DOMRect's fields are prototype getters: spreading it would copy nothing.
    let out = {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
    };
    // The element itself clips too: screen-reader-only labels and truncated titles.
    for (let p: Element | null = el; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        const r = p.getBoundingClientRect();
        out = {
          left: Math.max(out.left, r.left),
          top: Math.max(out.top, r.top),
          right: Math.min(out.right, r.right),
          bottom: Math.min(out.bottom, r.bottom),
        };
      }
      if (style.position === "fixed") break;
    }
    return out.right - out.left > 2 && out.bottom - out.top > 2 ? out : null;
  };
  const layer = (el: Element): Element | null => {
    for (let p: Element | null = el; p; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === "fixed" || pos === "sticky") return p;
    }
    return null;
  };
  const visible = (el: Element) =>
    !el.closest("[aria-hidden='true'], [inert]") &&
    (el as HTMLElement).checkVisibility?.({
      opacityProperty: true,
      visibilityProperty: true,
    });
  const label = (el: Element) => {
    let text = (
      el.getAttribute("aria-label") ??
      // biome-ignore lint/performance/useDomNodeTextContent: the audit reads the rendered text, which skips hidden nodes
      (el as HTMLElement).innerText ??
      el.tagName
    )
      .replace(/\s+/gu, " ")
      .trim();
    for (const title of titles) text = text.split(title).join("<song>");
    return `${el.tagName.toLowerCase()}"${text.slice(0, 40)}"`;
  };
  const controls: { el: Element; box: Box; layer: Element | null }[] = [];
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (!visible(el)) continue;
    const box = clip(el, el.getBoundingClientRect());
    if (box) controls.push({ el, box, layer: layer(el) });
  }
  const texts: {
    el: Element;
    box: Box;
    layer: Element | null;
    text: string;
  }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent?.trim();
    const parent = node.parentElement;
    if (!value || !parent || !visible(parent)) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(parent.tagName))
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      const box = clip(parent, r);
      if (box)
        texts.push({
          el: parent,
          box,
          layer: layer(parent),
          text: value.slice(0, 30),
        });
    }
  }
  const hit = (a: Box, b: Box) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  const found = new Set<string>();
  for (let i = 0; i < controls.length; i++) {
    const a = controls[i] as (typeof controls)[number];
    for (let j = i + 1; j < controls.length; j++) {
      const b = controls[j] as (typeof controls)[number];
      if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el))
        continue;
      if (hit(a.box, b.box)) found.add(`${label(a.el)} x ${label(b.el)}`);
    }
    for (const t of texts) {
      if (a.layer !== t.layer || a.el.contains(t.el) || t.el.contains(a.el))
        continue;
      // Text of a label wrapping its own control is not an overlap.
      if (t.el.closest("label")?.contains(a.el)) continue;
      if (hit(a.box, t.box)) {
        let text = t.text;
        for (const title of titles) text = text.split(title).join("<song>");
        found.add(`${label(a.el)} x text"${text}"`);
      }
    }
  }
  return [...found];
};

// Runs in the page: song cards without a visible cover, and cover image URLs to check.
const COVERS = (titles: string[]): { missing: string[]; urls: string[] } => {
  const missing: string[] = [];
  const urls = new Set<string>();
  for (const article of document.querySelectorAll("article")) {
    const name =
      article.getAttribute("aria-label") ??
      (article.getAttribute("aria-labelledby")
        ? document.getElementById(article.getAttribute("aria-labelledby") ?? "")
            ?.textContent
        : null) ??
      "";
    const title = titles.find((t) => name.trim() === t);
    if (!title) continue;
    if (!(article as HTMLElement).checkVisibility?.()) continue;
    if (article.querySelector(".shimmer")) continue; // a song being made shows its placeholder
    let shown = false;
    for (const el of article.querySelectorAll("*")) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none" && el.getBoundingClientRect().width >= 24) {
        shown = true;
        for (const m of bg.matchAll(/url\("?([^")]+)"?\)/gu))
          if (m[1]) urls.add(m[1]);
      }
      if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0)
        shown = true;
      if (
        el instanceof HTMLImageElement &&
        el.complete &&
        el.naturalWidth === 0
      )
        missing.push(`${title} (immagine non caricata)`);
      if (el instanceof HTMLVideoElement && el.readyState >= 2) shown = true;
    }
    if (!shown) missing.push(title);
  }
  return { missing, urls: [...urls] };
};

// ---------- the sweep ----------

async function settle(page: Page, ms = 500) {
  for (let i = 0; i < 6; i++) {
    const before = await page.evaluate(
      () => (window as unknown as { __mut: number }).__mut,
    );
    await page.waitForTimeout(ms);
    const after = await page.evaluate(
      () => (window as unknown as { __mut: number }).__mut,
    );
    if (after === before) return;
  }
}

async function pauseAll(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __media: Set<HTMLMediaElement> };
    for (const m of w.__media) m.pause();
    for (const m of document.querySelectorAll("audio, video"))
      (m as HTMLMediaElement).pause();
  });
}

async function auditPage(
  browser: Browser,
  storage: string,
  path: string,
  viewport: { width: number; height: number },
  titles: string[],
) {
  const vp = `${viewport.width}x${viewport.height}`;
  const started = Date.now();
  const context = await browser.newContext({ storageState: storage, viewport });
  const page = await context.newPage();
  await page.addInitScript(INIT);
  try {
    // (e) while the page loads and settles.
    const errors = new Set<string>();
    page.on("console", (msg) => {
      if (msg.type() === "error")
        errors.add(
          `console: ${msg.text().replace(/\s+/gu, " ").slice(0, 200)}`,
        );
    });
    page.on("pageerror", (error) =>
      errors.add(`pageerror: ${error.message.slice(0, 200)}`),
    );
    page.on("response", (response) => {
      if (response.status() >= 500)
        errors.add(
          `${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`,
        );
    });
    await page.goto(path, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    await settle(page);
    for (const error of errors) defect("e", path, vp, error);
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
    page.removeAllListeners("response");

    // (b) overlaps, at the top and after scrolling to the end.
    const overlaps = new Set(await page.evaluate(OVERLAPS, titles));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    for (const o of await page.evaluate(OVERLAPS, titles)) overlaps.add(o);
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const o of overlaps) defect("b", path, vp, o);

    // (c) covers.
    const covers = await page.evaluate(COVERS, titles);
    for (const m of covers.missing)
      defect("c", path, vp, `senza copertina: ${m}`);
    for (const url of covers.urls) {
      if (url.startsWith("data:")) continue;
      const status = await page.evaluate(
        async (u) => (await fetch(u, { method: "GET" })).status,
        url,
      );
      if (status >= 400)
        defect(
          "c",
          path,
          vp,
          `copertina ${status}: ${new URL(url, page.url()).pathname}`,
        );
    }

    // (d) play controls.
    const { keys } = await page.evaluate(SCAN, { titles, mark: null });
    const plays = keys.filter((k) =>
      /^(button|a|link):(Riproduci|Ascolta)/u.test(k),
    );
    for (const key of plays) {
      await page.goto(path, { waitUntil: "load" });
      await settle(page);
      const { marked } = await page.evaluate(SCAN, { titles, mark: key });
      if (!marked) continue;
      await page
        .locator("[data-audit-target]")
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
      const playing = await page
        .waitForFunction(
          () => {
            const w = window as unknown as { __media: Set<HTMLMediaElement> };
            const all = [
              ...w.__media,
              ...document.querySelectorAll("audio, video"),
            ] as HTMLMediaElement[];
            return (
              all.some((m) => !m.paused && m.currentTime > 0) ||
              (window as unknown as { __webaudio: number }).__webaudio > 0
            );
          },
          undefined,
          { timeout: EFFECT_MS + 2000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!playing) defect("d", path, vp, `nessun audio: ${key}`);
      await pauseAll(page);
    }

    // (a) every control has an effect.
    let requests = 0;
    let dialogs = 0;
    page.on("request", () => {
      requests++;
    });
    page.on("dialog", (dialog) => {
      dialogs++;
      void dialog.dismiss();
    });
    context.on("page", (popup) => {
      dialogs++;
      void popup.close();
    });
    page.on("download", () => {
      dialogs++;
    });
    await page.route("**/*", (route) =>
      ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
        ? route.continue()
        : route.abort(),
    );
    await page.goto(path, { waitUntil: "load" });
    await settle(page);
    const all = (await page.evaluate(SCAN, { titles, mark: null })).keys.slice(
      0,
      MAX_CONTROLS,
    );
    let dirty = false;
    const retried = new Set<string>();
    for (let i = 0; i < all.length; i++) {
      const key = all[i] as string;
      if (dirty || page.url() !== new URL(path, page.url()).href) {
        await page.goto(path, { waitUntil: "load" });
        await settle(page);
        dirty = false;
      }
      const { marked } = await page.evaluate(SCAN, { titles, mark: key });
      if (!marked) continue;
      const target = page.locator("[data-audit-target]").first();
      const ok = await target
        .hover({ timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!ok) continue; // covered or moved away: not clickable by a person either way
      await page.waitForTimeout(400);
      await settle(page, 300);
      const url = page.url();
      const mutBefore = await page.evaluate(
        () => (window as unknown as { __mut: number }).__mut,
      );
      requests = 0;
      dialogs = 0;
      const clicked = await target
        .click({ timeout: 3000, noWaitAfter: true })
        .then(() => true)
        .catch(() => false);
      // Not clickable (covered by a transient toast or moved away): try once more from a fresh
      // page; a control that stays unclickable is not a click without effect.
      if (!clicked) {
        dirty = true;
        if (!retried.has(key)) {
          retried.add(key);
          i--;
        }
        continue;
      }
      const effect = await (async () => {
        const end = Date.now() + EFFECT_MS;
        while (Date.now() < end) {
          if (page.url() !== url || requests > 0 || dialogs > 0) return true;
          const mut = await page
            .evaluate(() => (window as unknown as { __mut: number }).__mut)
            .catch(() => -1);
          if (mut === -1 || mut !== mutBefore) return true;
          await page.waitForTimeout(150);
        }
        return false;
      })();
      if (!effect) defect("a", path, vp, `nessun effetto: ${key}`);
      await pauseAll(page).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      // Reload only when the click left the page in another state than a closed menu.
      dirty =
        page.url() !== url ||
        dialogs > 0 ||
        (await page
          .locator(
            "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-sonner-toast]",
          )
          .count()
          .catch(() => 1)) > 0;
    }
    console.log(
      `[audit] ${path} ${vp}: ${all.length} controls, ${Math.round((Date.now() - started) / 1000)} s`,
    );
  } finally {
    await context.close();
  }
}

let seeded: Seeded | undefined;

// The detectors must find what they are meant to find; a broken detector crashes the run.
test("self-test of the detectors", async ({ page }) => {
  await page.setContent(`
    <main>
      <button style="position:absolute;left:0;top:0;width:120px;height:30px">Uno</button>
      <span style="position:absolute;left:60px;top:8px">testo sopra</span>
      <label style="position:absolute;left:4px;top:4px;width:1px;height:1px;overflow:hidden;white-space:nowrap">etichetta nascosta</label>
      <article aria-label="Senza"><div style="width:84px;height:84px"></div></article>
      <article aria-label="Con"><div style="width:84px;height:84px;background:linear-gradient(red,blue)"></div></article>
      <a href="#">vuoto</a>
      <button role="radio" aria-checked="true" style="position:absolute;left:0;top:200px">Scelto</button>
    </main>`);
  await page.evaluate(INIT);
  expect(await page.evaluate(OVERLAPS, [])).toEqual([
    'button"Uno" x text"testo sopra"',
  ]);
  expect(await page.evaluate(COVERS, ["Senza", "Con"])).toEqual({
    missing: ["Senza"],
    urls: [],
  });
  expect((await page.evaluate(SCAN, { titles: [], mark: null })).keys).toEqual([
    "button:Uno",
  ]);
});

test("pages: buttons, overlaps, covers, playback and errors", async ({
  browser,
  page,
}) => {
  test.setTimeout(3 * 60 * 60_000);
  seeded = await seed();
  const s = seeded;
  try {
    await signIn(page);
    const storage = join(ROOT, "tmp/audit-state.json");
    await page.context().storageState({ path: storage });
    const v = (key: string) =>
      s.versions.get(key) as { id: string; projectId: string };
    const pages = [
      "/create",
      "/library",
      "/library?tab=videos",
      "/playlists",
      `/playlists/${s.playlistId}`,
      "/search",
      "/credits",
      "/settings",
      "/settings/agents",
      `/projects/${v("video e copertina").projectId}?lang=it`,
      `/projects/${v("take da scegliere").projectId}?lang=it`,
      `/projects/${v("video da rivedere").projectId}?lang=it`,
      `/editor/${v("copertina senza video").id}`,
      `/editor/${v("copertina senza video").id}?tab=rewrite`,
      `/stems/${v("copertina senza video").id}`,
    ];
    const titles = SONGS.map(titleOf).sort((a, b) => b.length - a.length);
    // The dev server compiles a route on its first visit: warm every route first so a slow
    // compile is never read as a click without effect.
    for (const path of pages) {
      await page.goto(path, { waitUntil: "load" });
      await page.waitForTimeout(500);
    }
    // MDF_AUDIT_ONLY narrows the pages while debugging; the scorer never sets it.
    const only = process.env.MDF_AUDIT_ONLY;
    for (const path of pages.filter((p) => !only || p.includes(only)))
      for (const viewport of VIEWPORTS)
        await auditPage(browser, storage, path, viewport, titles);
  } finally {
    await unseed(s);
  }
});

// ---------- the owner's F1 requests with a UI ----------

test.describe("F1 requests", () => {
  // Every step is bounded so a missing control ends the check, not the test.
  test.use({ actionTimeout: 15_000 });
  let worker: Awaited<ReturnType<typeof startFakeWorker>> | undefined;
  test.beforeAll(async () => {
    worker = await startFakeWorker();
  });
  test.afterAll(async () => {
    if (worker) await stopWorker(worker);
  });

  async function check(name: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      defect(
        "f1",
        name,
        "1440x900",
        (error instanceof Error ? error.message : String(error))
          // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI colour codes.
          .replace(/\u001b\[[0-9;]*m/gu, "")
          .split("\n")
          .filter(Boolean)
          .slice(0, 2)
          .join(" | "),
      );
    }
  }

  async function oneSong(song: Song & { lyricsReady?: boolean }) {
    const db = serviceClient();
    const owner = await getAdminId();
    const title = `${TAG} ${song.key}`;
    const project = await must(
      db
        .from("projects")
        .insert({
          owner_id: owner,
          topic: title,
          song_settings: song.settings ?? {},
        })
        .select("id")
        .single(),
    );
    const version = await must(
      db
        .from("versions")
        .insert({
          owner_id: owner,
          project_id: project.id,
          lang: "it",
          status: song.status,
          display_title: title,
          lyric_pack: { ...PACK, title },
          lyric_timing: song.takes ? TIMING : null,
        })
        .select("id")
        .single(),
    );
    // A part is 10-30 s and at most half the song: the song must be long enough to edit.
    const audio = wav(60);
    let first: string | null = null;
    for (let n = 1; n <= song.takes; n++) {
      const path = `previews/${owner}/${project.id}/it/take-${n}.wav`;
      const up = await db.storage
        .from("previews")
        .upload(path, audio, { contentType: "audio/wav", upsert: true });
      if (up.error) throw up.error;
      const take = await must(
        db
          .from("takes")
          .insert({
            owner_id: owner,
            version_id: version.id,
            generation: 1,
            take_number: n,
            audio_preview_path: path,
            lyric_timing: TIMING,
          })
          .select("id")
          .single(),
      );
      first ??= take.id;
    }
    if (song.chosen && first)
      await must(
        db
          .from("versions")
          .update({ chosen_take_id: first })
          .eq("id", version.id)
          .select("id"),
      );
    return { title, projectId: project.id, versionId: version.id };
  }

  test("generate and regenerate lyrics", async ({ page }) => {
    test.setTimeout(240_000);
    await check("generare e rigenerare il testo", async () => {
      const db = serviceClient();
      const email = `e2e-audit-${crypto.randomUUID()}@mellodifai.test`;
      let userId: string | undefined;
      try {
        await db.from("admin_allowlist").insert({ email, role: "customer" });
        const created = await db.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        userId = created.data.user?.id;
        if (!userId) throw new Error("utente di prova non creato");
        await signIn(page, email);
        await page.getByRole("radio", { name: "Avanzato" }).click();
        const lyrics = page.getByRole("textbox", {
          name: "Testo",
          exact: true,
        });
        await page.getByRole("button", { name: "Scrivi con AI" }).click();
        await page
          .getByLabel("Di cosa parla la canzone?")
          .fill("una mattina di sole in città");
        await page.getByRole("button", { name: "Scrivi", exact: true }).click();
        await expect(lyrics, "il testo scritto non arriva").toHaveValue(
          /mattino/u,
          {
            timeout: 60_000,
          },
        );
        const first = await lyrics.inputValue();
        await page
          .getByRole("button", { name: /^Rigenera/u })
          .first()
          .click({ timeout: 10_000 });
        await expect(lyrics, "Rigenera non cambia il testo").not.toHaveValue(
          first,
          { timeout: 60_000 },
        );
        const second = await lyrics.inputValue();
        await page.reload();
        await page.getByRole("radio", { name: "Avanzato" }).click();
        await expect(
          page.getByRole("textbox", { name: "Testo", exact: true }),
          "il testo rigenerato non resta salvato",
        ).toHaveValue(second, {
          timeout: 15_000,
        });
      } finally {
        if (userId) await db.auth.admin.deleteUser(userId);
        await db.from("admin_allowlist").delete().eq("email", email);
      }
    });
  });

  async function startRemake(page: Page) {
    const db = serviceClient();
    await db
      .from("remakes")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("owner_id", await getAdminId())
      .is("dismissed_at", null);
    await signIn(page);
    const card = page.getByRole("region", { name: "Rifai da YouTube" });
    await card.getByLabel("Link YouTube").fill("https://youtu.be/49rDdMbXd_w");
    await card.getByLabel("Lingua del testo").selectOption("it");
    await card.getByRole("button", { name: "Analizza" }).click();
    await expect(
      card.getByRole("textbox", { name: "Titolo nuovo" }),
    ).toHaveValue(/\S/u, {
      timeout: 120_000,
    });
    return card;
  }

  test("paste a YouTube link", async ({ page }) => {
    test.setTimeout(240_000);
    await check("incollare un link YouTube", async () => {
      const card = await startRemake(page);
      await expect(
        card.getByRole("button", { name: /^Modifica la riga \d+:/u }).first(),
      ).toBeVisible();
    });
  });

  test("devil's-advocate objection accepted changes the lyrics", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await check("accettare un'obiezione cambia il testo", async () => {
      const card = await startRemake(page);
      const jury = card.getByRole("region", { name: "Giuria" });
      await jury.getByRole("button", { name: /^Note della giuria/u }).click();
      const line = card.getByRole("button", { name: /^Modifica la riga 9:/u });
      const before = await line.getAttribute("aria-label");
      const accept = jury
        .getByRole("button", { name: /accett|applica/iu })
        .first();
      await expect(
        accept,
        "nessun comando per accettare un'obiezione",
      ).toBeVisible({ timeout: 5000 });
      await accept.click();
      await expect
        .poll(() => line.getAttribute("aria-label"), { timeout: 60_000 })
        .not.toBe(before);
      const { data } = await serviceClient()
        .from("remakes")
        .select("lyrics")
        .eq("owner_id", await getAdminId())
        .is("dismissed_at", null)
        .single();
      const text = JSON.stringify(data?.lyrics ?? {});
      const after =
        (await line.getAttribute("aria-label"))?.replace(
          /^Modifica la riga 9: /u,
          "",
        ) ?? "";
      expect(text, "il testo nuovo non è salvato").toContain(after);
    });
  });

  test("audio only", async ({ page }) => {
    test.setTimeout(120_000);
    await check("solo audio", async () => {
      const song = await oneSong({
        key: "solo audio",
        status: "takes_review",
        takes: 2,
        settings: { video: "off" },
      });
      try {
        await signIn(page);
        await page.goto("/library");
        const card = page.getByRole("article", {
          name: song.title,
          exact: true,
        });
        await card.getByRole("button", { name: "Scegli la take" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("radio", { name: /^Take 1/u }).click();
        await dialog
          .getByRole("button", { name: "Tieni solo l'audio" })
          .click();
        await expect
          .poll(
            async () =>
              (
                await serviceClient()
                  .from("versions")
                  .select("status")
                  .eq("id", song.versionId)
                  .single()
              ).data?.status,
            { timeout: 30_000 },
          )
          .toBe("audio_ready");
      } finally {
        await serviceClient()
          .from("projects")
          .delete()
          .eq("id", song.projectId);
      }
    });
  });

  test("produce the video once lyrics are ready", async ({ page }) => {
    test.setTimeout(120_000);
    await check("produrre il video a testo pronto", async () => {
      const song = await oneSong({
        key: "video a testo pronto",
        status: "lyrics_review",
        takes: 0,
        settings: { video: "off" },
      });
      try {
        await signIn(page);
        await page.goto("/library");
        const card = page.getByRole("article", {
          name: song.title,
          exact: true,
        });
        await card.getByRole("button", { name: "Approva e crea" }).click();
        const dialog = page.getByRole("dialog");
        const video = dialog
          .getByRole("button", { name: /video/iu })
          .or(dialog.getByRole("radio", { name: /video/iu }))
          .or(dialog.getByRole("checkbox", { name: /video/iu }))
          .or(dialog.getByRole("switch", { name: /video/iu }))
          .first();
        await expect(
          video,
          "nessun comando per il video a testo pronto",
        ).toBeVisible({ timeout: 5000 });
        await video.click();
        await expect
          .poll(
            async () => {
              const { data } = await serviceClient()
                .from("projects")
                .select("song_settings")
                .eq("id", song.projectId)
                .single();
              return (
                (data?.song_settings as { video?: string } | null)?.video ?? ""
              );
            },
            { timeout: 30_000 },
          )
          .not.toBe("off");
      } finally {
        await serviceClient()
          .from("projects")
          .delete()
          .eq("id", song.projectId);
      }
    });
  });

  test("replace a section", async ({ page }) => {
    test.setTimeout(240_000);
    await check("sostituire una parte", async () => {
      const song = await oneSong({
        key: "sostituire una parte",
        status: "audio_ready",
        takes: 1,
        chosen: true,
      });
      try {
        await signIn(page);
        await page.goto(`/editor/${song.versionId}?tab=rewrite`);
        await page
          .getByRole("button", {
            name: /^Segna o togli la riga: La luna splende/u,
          })
          .click();
        await page
          .getByPlaceholder("Il nuovo testo della parte")
          .fill("Il sole risplende sul porto");
        await page.getByRole("button", { name: "Ricrea la parte" }).click();
        const confirm = page
          .getByRole("dialog")
          .getByRole("button", { name: /Ricrea|Conferma/u });
        if (await confirm.isVisible({ timeout: 3000 }).catch(() => false))
          await confirm.first().click();
        await page
          .getByRole("button", { name: "Tieni questa" })
          .first()
          .click({ timeout: 120_000 });
        await expect
          .poll(
            async () =>
              (
                await serviceClient()
                  .from("takes")
                  .select("id")
                  .eq("version_id", song.versionId)
              ).data?.length ?? 0,
            { timeout: 60_000 },
          )
          .toBeGreaterThan(1);
      } finally {
        await serviceClient()
          .from("projects")
          .delete()
          .eq("id", song.projectId);
      }
    });
  });
});
