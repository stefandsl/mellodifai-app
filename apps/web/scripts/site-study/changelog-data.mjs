#!/usr/bin/env node
// Build-time data step for /changelog (C09).
// Reads git tags (name, date) from the repository and joins content/changelog/<tag>.md
// when present. Parses Markdown into a safe AST with no raw HTML support.
// Works in CI and shallow clones: fetches tags if missing, or fails with a clear error.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
export const DEFAULT_CONTENT_DIR = join(
  DEFAULT_REPO_ROOT,
  "content",
  "changelog",
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
    // Escaped punctuation: \* \[ \` \\ etc.
    if (text[i] === "\\" && i + 1 < text.length) {
      pushText(text[i + 1]);
      i += 2;
      continue;
    }

    // Inline code: `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Markdown link: [label](href)
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

    // Bold: **text**
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

    // Emphasis: *text* (only when not a lone space after *)
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
 * Supports:
 * - First `# Heading` as the entry title
 * - `##` and `###` subheadings (rendered as h3 / h4 under the entry h2)
 * - Unordered (`- `, `* `) and ordered (`1. `) lists
 * - Fenced code blocks (```)
 * - Paragraphs with inline bold, italic, code, and safe links
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

  // Optional simple frontmatter: title: ...
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

    // Fenced code block
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

    // Headings (#, ##, ###)
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

    // Unordered list (- item or * item)
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

    // Ordered list (1. item)
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

    // Paragraph (join consecutive non-empty plain lines)
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
 * Parse lines emitted by `git for-each-ref --format=%(refname:short)%x09%(creatordate:iso-strict)%x09%(objecttype) refs/tags`.
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
  tags.sort((a, b) => {
    const ta = Date.parse(a.isoDate);
    const tb = Date.parse(b.isoDate);
    if (Number.isFinite(ta) && Number.isFinite(tb) && tb !== ta) {
      return tb - ta;
    }
    return b.tag.localeCompare(a.tag);
  });
  return tags;
}

/**
 * Read git tags from repoRoot. In a shallow clone or CI checkout that omitted tags,
 * attempts `git fetch --tags` from origin (or the first configured remote) once.
 * Never silently returns zero tags: throws a clear, actionable error if no tags exist.
 *
 * @param {{ repoRoot?: string, allowFetch?: boolean, runGit?: (args: string[], cwd: string) => string }} [options]
 */
export function collectGitTags(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const allowFetch = options.allowFetch ?? true;
  const runGit = options.runGit ?? defaultRunGit;

  const listArgs = [
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname:short)\t%(creatordate:iso-strict)\t%(objecttype)",
    "refs/tags",
  ];

  /** @param {string[]} args */
  const execGit = (args) => {
    try {
      return runGit(args, repoRoot);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `changelog-data: failed to read git tags in ${repoRoot} (${detail}). Ensure git is available and tags are present ("git fetch --tags").`,
      );
    }
  };

  let tags = parseGitTagLines(execGit(listArgs));

  if (tags.length === 0 && allowFetch) {
    let remote = "";
    try {
      const remotes = runGit(["remote"], repoRoot)
        .split(/\r?\n/u)
        .map((r) => r.trim())
        .filter(Boolean);
      remote = remotes.includes("origin") ? "origin" : (remotes[0] ?? "");
    } catch {
      remote = "";
    }

    if (remote) {
      try {
        runGit(
          ["fetch", "--tags", "--no-write-fetch-head", "--quiet", remote],
          repoRoot,
        );
        tags = parseGitTagLines(execGit(listArgs));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `changelog-data: no local git tags found in ${repoRoot}, and automatic "git fetch --tags ${remote}" failed (${detail}). Fetch tags before building ("git fetch --tags" or actions/checkout with fetch-tags: true).`,
        );
      }
    }
  }

  if (tags.length === 0) {
    throw new Error(
      `changelog-data: no git tags found in ${repoRoot}. Cannot build /changelog with zero entries. In CI or a shallow clone, fetch tags before building ("git fetch --tags" or actions/checkout with fetch-tags: true).`,
    );
  }

  return tags;
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
 * git tags with optional content/changelog/<tag>.md files.
 *
 * @param {{ repoRoot?: string, contentDir?: string, allowFetch?: boolean, runGit?: (args: string[], cwd: string) => string }} [options]
 */
export function loadChangelogEntries(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const contentDir = resolve(
    options.contentDir ?? join(repoRoot, "content", "changelog"),
  );
  const tags = collectGitTags({
    repoRoot,
    allowFetch: options.allowFetch,
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
    const entries = loadChangelogEntries();
    process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
