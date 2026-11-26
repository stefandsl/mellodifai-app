#!/usr/bin/env node
// Build-time data step for /changelog (C09).
// Reads git tags (name, tagger's calendar date, exact git order) from the repository
// when `.git` is present, or from `content/changelog/tags.json` in archive builds
// without `.git` (such as the Windows desktop installer). Joins `content/changelog/<tag>.md`
// when present and parses Markdown into a safe AST with no raw HTML support.
// Never invokes the network (`git fetch`): fails loudly if tags are missing or if the
// committed tag snapshot drifts from git tags in CI.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
export const DEFAULT_CONTENT_DIR = join(
  DEFAULT_REPO_ROOT,
  "content",
  "changelog",
);
export const SNAPSHOT_FILENAME = "tags.json";
export const DEFAULT_SNAPSHOT_PATH = join(
  DEFAULT_CONTENT_DIR,
  SNAPSHOT_FILENAME,
);

const SAFE_URL_RE = /^(?:https?:\/\/|\/(?!\/)|#)/iu;

/**
 * Convert a git tag name into a deterministic, HTML-safe anchor id.
 * @param {string} tag
 * @returns {string}
 */
export function tagToAnchorId(tag) {
  const cleaned = tag
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return `release-${cleaned || "tag"}`;
}

/**
 * Validate a link target in changelog Markdown. Rejects javascript:, data:, vbscript:,
 * protocol-relative URLs, and control characters.
 * @param {string} rawHref
 * @returns {string | null}
 */
export function sanitizeMarkdownHref(rawHref) {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;
  for (let idx = 0; idx < trimmed.length; idx += 1) {
    const code = trimmed.charCodeAt(idx);
    if (code <= 0x1f || code === 0x7f) return null;
  }
  if (!SAFE_URL_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Parse inline Markdown spans safely (code, links, strong, em).
 * Raw HTML tags are left as plain literal text and never interpreted as HTML.
 * @param {string} text
 * @returns {Array<{ type: "text", text: string } | { type: "strong", children: any[] } | { type: "em", children: any[] } | { type: "code", text: string } | { type: "link", label: string, href: string }>}
 */
export function parseInlineMarkdown(text) {
  /** @type {any[]} */
  const out = [];
  let i = 0;

  const pushText = (chunk) => {
    if (!chunk) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text") prev.text += chunk;
    else out.push({ type: "text", text: chunk });
  };

  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      pushText(text[i + 1]);
      i += 2;
      continue;
    }

    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (text[i] === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket > i + 1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket + 2) {
          const label = text.slice(i + 1, closeBracket);
          const rawHref = text.slice(closeBracket + 2, closeParen);
          const safeHref = sanitizeMarkdownHref(rawHref);
          if (safeHref) {
            out.push({ type: "link", label, href: safeHref });
          } else {
            pushText(label);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        out.push({
          type: "strong",
          children: parseInlineMarkdown(text.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }

    if (text[i] === "*" && text[i + 1] && text[i + 1] !== " ") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1 && text[end - 1] !== " ") {
        out.push({
          type: "em",
          children: parseInlineMarkdown(text.slice(i + 1, end)),
        });
        i = end + 1;
        continue;
      }
    }

    pushText(text[i]);
    i += 1;
  }

  return out;
}

/**
 * Parse a changelog Markdown document into a title, optional summary, and safe block AST.
 * Raw HTML is never parsed or emitted; angle brackets remain plain text.
 * @param {string} raw
 */
export function parseSafeMarkdown(raw) {
  const normalized = raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");

  /** @type {string | null} */
  let title = null;
  /** @type {string | null} */
  let summary = null;
  /** @type {Array<any>} */
  const blocks = [];

  let i = 0;

  if (lines[0]?.trim() === "---") {
    let endIdx = -1;
    for (let j = 1; j < lines.length; j += 1) {
      if (lines[j].trim() === "---") {
        endIdx = j;
        break;
      }
    }
    if (endIdx > 0) {
      for (let j = 1; j < endIdx; j += 1) {
        const m = /^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/u.exec(lines[j].trim());
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim().replace(/^["']|["']$/gu, "");
        if (key === "title" && val) title = val;
        if (key === "summary" && val) summary = val;
      }
      i = endIdx + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const fence = /^```([a-zA-Z0-9_-]*)\s*$/u.exec(trimmed);
    if (fence) {
      const lang = fence[1] || undefined;
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/u.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", text: codeLines.join("\n"), lang });
      continue;
    }

    const heading = /^(#{1,3})\s+(.+?)\s*#*$/u.exec(trimmed);
    if (heading) {
      const depth = heading[1].length;
      const text = heading[2].trim();
      if (depth === 1 && title === null) {
        title = text;
      } else {
        const level = depth <= 2 ? 2 : 3;
        blocks.push({
          type: "heading",
          level,
          inlines: parseInlineMarkdown(text),
        });
      }
      i += 1;
      continue;
    }

    if (/^[-*]\s+/u.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/u.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*]\s+/u, "");
        items.push(parseInlineMarkdown(itemText));
        i += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/u.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/u.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/u, "");
        items.push(parseInlineMarkdown(itemText));
        i += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/u.test(lines[i].trim()) &&
      !/^#{1,3}\s+/u.test(lines[i].trim()) &&
      !/^[-*]\s+/u.test(lines[i].trim()) &&
      !/^\d+\.\s+/u.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    const paraText = paraLines.join(" ");
    if (summary === null && blocks.length === 0) {
      summary = paraText;
    }
    blocks.push({
      type: "paragraph",
      inlines: parseInlineMarkdown(paraText),
    });
  }

  return { title, summary, blocks };
}

/**
 * Default git runner using execFileSync (no shell).
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function defaultRunGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Parse lines emitted by `git for-each-ref --sort=-creatordate --format=%(refname:short)\t%(creatordate:iso-strict)\t%(objecttype) refs/tags`.
 * Preserves git's exact emitted order (newest creatordate first, ties broken by refname ascending).
 * @param {string} stdout
 */
export function parseGitTagLines(stdout) {
  /** @type {Array<{ tag: string, date: string, isoDate: string, objectType: string }>} */
  const tags = [];
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [tag, isoDate, objectType = "commit"] = line.split("\t");
    if (!tag || !isoDate) continue;
    const dateMatch = /^(\d{4}-\d{2}-\d{2})/u.exec(isoDate);
    if (!dateMatch) continue;
    tags.push({
      tag,
      date: dateMatch[1],
      isoDate,
      objectType,
    });
  }
  return tags;
}

/**
 * Read and validate a committed or archive-generated tag snapshot file (`content/changelog/tags.json`).
 * @param {string} snapshotPath
 */
export function readTagSnapshot(snapshotPath) {
  const abs = resolve(snapshotPath);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error(
      `changelog-data: missing tag snapshot at ${abs}. Build inside a git checkout with tags, or generate content/changelog/tags.json with "node apps/web/scripts/site-study/changelog-data.mjs --write-snapshot".`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `changelog-data: invalid JSON in tag snapshot ${abs} (${detail}).`,
    );
  }
  const rawList = Array.isArray(parsed) ? parsed : parsed?.tags;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new Error(
      `changelog-data: tag snapshot ${abs} has zero entries. Cannot build /changelog with zero tags.`,
    );
  }
  /** @type {Array<{ tag: string, date: string, isoDate: string, objectType: string }>} */
  const tags = [];
  for (const item of rawList) {
    if (
      !item ||
      typeof item.tag !== "string" ||
      !item.tag.trim() ||
      typeof item.isoDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}/u.test(item.isoDate)
    ) {
      throw new Error(
        `changelog-data: malformed tag entry in snapshot ${abs}: ${JSON.stringify(item)}`,
      );
    }
    const date =
      typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(item.date)
        ? item.date
        : item.isoDate.slice(0, 10);
    tags.push({
      tag: item.tag,
      date,
      isoDate: item.isoDate,
      objectType:
        typeof item.objectType === "string" ? item.objectType : "commit",
    });
  }
  return tags;
}

/**
 * Compare live git tags against the snapshot list (name, date, isoDate, and exact order).
 * Throws a clear error if they differ.
 * @param {Array<{ tag: string, date: string, isoDate: string }>} gitTags
 * @param {Array<{ tag: string, date: string, isoDate: string }>} snapshotTags
 * @param {string} snapshotPath
 */
export function assertSnapshotMatchesGit(gitTags, snapshotTags, snapshotPath) {
  const diffs = [];
  if (gitTags.length !== snapshotTags.length) {
    diffs.push(
      `count differs (git has ${gitTags.length}, snapshot has ${snapshotTags.length})`,
    );
  }
  const max = Math.max(gitTags.length, snapshotTags.length);
  for (let i = 0; i < max; i += 1) {
    const g = gitTags[i];
    const s = snapshotTags[i];
    if (!g || !s) {
      diffs.push(
        `index ${i}: git=${g ? g.tag : "<missing>"}, snapshot=${s ? s.tag : "<missing>"}`,
      );
      break;
    }
    if (g.tag !== s.tag || g.date !== s.date || g.isoDate !== s.isoDate) {
      diffs.push(
        `index ${i}: git=${g.tag} (${g.isoDate}), snapshot=${s.tag} (${s.isoDate})`,
      );
      break;
    }
  }
  if (diffs.length > 0) {
    throw new Error(
      `changelog-data: tag snapshot ${snapshotPath} is out of date with git tags (${diffs.join("; ")}). Refresh it with "node apps/web/scripts/site-study/changelog-data.mjs --write-snapshot".`,
    );
  }
}

/**
 * Read git tags directly from a repository with `.git`. Never calls the network.
 * @param {string} repoRoot
 * @param {(args: string[], cwd: string) => string} runGit
 */
function readLiveGitTags(repoRoot, runGit) {
  const listArgs = [
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname:short)\t%(creatordate:iso-strict)\t%(objecttype)",
    "refs/tags",
  ];
  let stdout;
  try {
    stdout = runGit(listArgs, repoRoot);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `changelog-data: failed to read git tags in ${repoRoot} (${detail}). Fetch tags before building: git fetch --no-tags --depth=1 origin "+refs/tags/*:refs/tags/*"`,
    );
  }
  const tags = parseGitTagLines(stdout);
  if (tags.length === 0) {
    throw new Error(
      `changelog-data: no git tags found in ${repoRoot}. Cannot build /changelog with zero entries. Fetch tags before building: git fetch --no-tags --depth=1 origin "+refs/tags/*:refs/tags/*"`,
    );
  }
  return tags;
}

/**
 * Write the tag snapshot file (`content/changelog/tags.json`) from live git tags.
 * Used when refreshing the committed snapshot or staging a `git archive` build.
 * @param {{ repoRoot?: string, outPath?: string, runGit?: (args: string[], cwd: string) => string }} [options]
 */
export function writeTagSnapshot(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const outPath = resolve(
    options.outPath ??
      join(repoRoot, "content", "changelog", SNAPSHOT_FILENAME),
  );
  const runGit = options.runGit ?? defaultRunGit;
  const tags = readLiveGitTags(repoRoot, runGit);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({ tags }, null, 2)}\n`, "utf8");
  return { outPath, tags };
}

/**
 * Collect ordered tags for /changelog:
 * - When `.git` exists in `repoRoot`: reads tags from git (never calls the network) and fails
 *   loudly on zero tags. When `verifySnapshot` is true (default in CI, `process.env.CI === "true"`),
 *   compares git tags against `snapshotPath` and fails loudly if they drift.
 * - When `.git` does not exist (for example an extracted `git archive HEAD` in the Windows
 *   desktop installer): reads tags from `snapshotPath` (`content/changelog/tags.json`) and
 *   fails loudly if missing or empty.
 *
 * @param {{ repoRoot?: string, snapshotPath?: string, verifySnapshot?: boolean, runGit?: (args: string[], cwd: string) => string }} [options]
 */
export function collectGitTags(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const snapshotPath = resolve(
    options.snapshotPath ??
      join(repoRoot, "content", "changelog", SNAPSHOT_FILENAME),
  );
  const hasGit = existsSync(join(repoRoot, ".git"));
  const runGit = options.runGit ?? defaultRunGit;

  if (!hasGit && !options.runGit) {
    return readTagSnapshot(snapshotPath);
  }

  const gitTags = readLiveGitTags(repoRoot, runGit);
  const shouldVerify =
    options.verifySnapshot ?? (process.env.CI === "true" && !options.runGit);
  if (shouldVerify) {
    const snapshotTags = readTagSnapshot(snapshotPath);
    assertSnapshotMatchesGit(gitTags, snapshotTags, snapshotPath);
  }
  return gitTags;
}

/**
 * Safely resolve content/changelog/<tag>.md inside contentDir without allowing path traversal.
 * @param {string} contentDir
 * @param {string} tag
 * @returns {string | null}
 */
function resolveTagMarkdownPath(contentDir, tag) {
  if (tag.includes("/") || tag.includes("\\") || tag.includes("..")) {
    return null;
  }
  const base = resolve(contentDir);
  const candidate = resolve(base, `${tag}.md`);
  const rel = relative(base, candidate);
  if (!rel || rel.startsWith("..") || rel.includes("/") || rel.includes("\\")) {
    return null;
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    return null;
  }
  return candidate;
}

/**
 * Build the complete ordered list of changelog entries (newest tag first) by joining
 * git tags (or the archive tag snapshot) with optional `content/changelog/<tag>.md` files.
 *
 * @param {{ repoRoot?: string, contentDir?: string, snapshotPath?: string, verifySnapshot?: boolean, runGit?: (args: string[], cwd: string) => string }} [options]
 */
export function loadChangelogEntries(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const contentDir = resolve(
    options.contentDir ?? join(repoRoot, "content", "changelog"),
  );
  const snapshotPath = resolve(
    options.snapshotPath ?? join(contentDir, SNAPSHOT_FILENAME),
  );
  const tags = collectGitTags({
    repoRoot,
    snapshotPath,
    verifySnapshot: options.verifySnapshot,
    runGit: options.runGit,
  });

  const usedIds = new Set();
  return tags.map((tagInfo) => {
    let id = tagToAnchorId(tagInfo.tag);
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${tagToAnchorId(tagInfo.tag)}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    const mdPath = resolveTagMarkdownPath(contentDir, tagInfo.tag);
    if (!mdPath) {
      return {
        tag: tagInfo.tag,
        id,
        date: tagInfo.date,
        isoDate: tagInfo.isoDate,
        title: null,
        summary: null,
        blocks: [],
        hasNotes: false,
      };
    }

    const raw = readFileSync(mdPath, "utf8");
    const parsed = parseSafeMarkdown(raw);
    return {
      tag: tagInfo.tag,
      id,
      date: tagInfo.date,
      isoDate: tagInfo.isoDate,
      title: parsed.title,
      summary: parsed.summary,
      blocks: parsed.blocks,
      hasNotes: true,
    };
  });
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    if (process.argv.includes("--write-snapshot")) {
      const res = writeTagSnapshot();
      process.stdout.write(`Wrote ${res.tags.length} tags to ${res.outPath}\n`);
    } else {
      const entries = loadChangelogEntries();
      process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
