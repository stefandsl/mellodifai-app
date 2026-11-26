// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatChangelogDate } from "../../lib/site/changelog-types";
import {
  collectGitTags,
  loadChangelogEntries,
  parseGitTagLines,
  parseSafeMarkdown,
  sanitizeMarkdownHref,
  tagToAnchorId,
} from "./changelog-data.mjs";

const WEB_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(WEB_DIR, "../..");
const TMP_ROOT = join(
  process.env.TEMP || process.env.TMP || "E:/mellodifai/tmp",
  "changelog-data-tests",
);

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, prefix));
  createdDirs.push(dir);
  return dir;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

afterAll(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("changelog-data: safe Markdown parser", () => {
  it("parses headings, lists, paragraphs, code blocks, and safe inline formatting", () => {
    const md = [
      "# Studio release",
      "",
      "Short intro with **bold**, *italic*, `inline code`, and [Songbook](/recipes).",
      "",
      "## Highlights",
      "",
      "- First item with [Docs](https://mellodifai.com/docs)",
      "- Second item",
      "",
      "1. Step one",
      "2. Step two",
      "",
      "```bash",
      "mellodifai status",
      "```",
    ].join("\n");

    const parsed = parseSafeMarkdown(md);
    expect(parsed.title).toBe("Studio release");
    expect(parsed.summary).toContain("Short intro");
    expect(parsed.blocks).toHaveLength(5);
    expect(parsed.blocks[0]).toMatchObject({ type: "paragraph" });
    expect(parsed.blocks[1]).toEqual({
      type: "heading",
      level: 2,
      inlines: [{ type: "text", text: "Highlights" }],
    });
    expect(parsed.blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(parsed.blocks[3]).toMatchObject({ type: "list", ordered: true });
    expect(parsed.blocks[4]).toEqual({
      type: "code",
      text: "mellodifai status",
      lang: "bash",
    });
  });

  it("never parses raw HTML and neutralizes dangerous link protocols", () => {
    const md = [
      "# Safety check",
      "",
      'Raw <script>alert("xss")</script> and <img src=x onerror=alert(1)> stay text.',
      "",
      "- Bad JS [click](javascript:alert(1))",
      "- Bad data [open](data:text/html,<h1>x</h1>)",
      "- Protocol relative [ext](//evil.example/a)",
      "- Good relative [home](/)",
    ].join("\n");

    const parsed = parseSafeMarkdown(md);
    expect(parsed.blocks[0]).toEqual({
      type: "paragraph",
      inlines: [
        {
          type: "text",
          text: 'Raw <script>alert("xss")</script> and <img src=x onerror=alert(1)> stay text.',
        },
      ],
    });
    const list = parsed.blocks[1];
    expect(list.type).toBe("list");
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain("javascript:");
    expect(serialized).not.toContain("data:text/html");
    expect(serialized).not.toContain("//evil.example");
    expect(serialized).toContain('{"type":"link","label":"home","href":"/"}');

    expect(sanitizeMarkdownHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeMarkdownHref("vbscript:msgbox(1)")).toBeNull();
    expect(sanitizeMarkdownHref("data:text/html;base64,YQ==")).toBeNull();
    expect(sanitizeMarkdownHref("//example.com")).toBeNull();
    expect(sanitizeMarkdownHref("https://example.com/ok")).toBe(
      "https://example.com/ok",
    );
    expect(sanitizeMarkdownHref("/pricing")).toBe("/pricing");
  });
});

describe("changelog-data: git tag collection and shallow clone handling", () => {
  it("reads every real git tag in this repo newest-first and joins content/changelog/<tag>.md", () => {
    const realTagCount = git(["tag"], REPO_ROOT)
      .split(/\r?\n/u)
      .map((t) => t.trim())
      .filter(Boolean).length;
    expect(realTagCount).toBeGreaterThanOrEqual(11);

    const entries = loadChangelogEntries({ repoRoot: REPO_ROOT });
    expect(entries).toHaveLength(realTagCount);
    expect(entries[0].tag).toBe("native-20261122-r5");
    expect(entries[entries.length - 1].tag).toBe("m1-floor");

    for (let i = 1; i < entries.length; i += 1) {
      expect(Date.parse(entries[i - 1].isoDate)).toBeGreaterThanOrEqual(
        Date.parse(entries[i].isoDate),
      );
    }

    for (const entry of entries) {
      expect(entry.id).toBe(tagToAnchorId(entry.tag));
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      const mdFile = join(REPO_ROOT, "content", "changelog", `${entry.tag}.md`);
      if (existsSync(mdFile)) {
        expect(entry.hasNotes, entry.tag).toBe(true);
        expect(entry.title, entry.tag).toBeTruthy();
        expect(entry.blocks.length, entry.tag).toBeGreaterThan(0);
      }
    }
  });

  it("handles tags without a matching markdown file (date and name only)", () => {
    const contentDir = makeTempDir("notes-partial-");
    writeFileSync(
      join(contentDir, "v2.0.0.md"),
      "# Second release\n\nAdded export support.\n",
      "utf8",
    );

    const fakeGit = () =>
      [
        "v2.0.0\t2026-11-20T12:00:00+00:00\ttag",
        "v1.0.0\t2026-11-10T09:00:00+00:00\tcommit",
      ].join("\n");

    const entries = loadChangelogEntries({
      repoRoot: REPO_ROOT,
      contentDir,
      allowFetch: false,
      runGit: fakeGit,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      tag: "v2.0.0",
      id: "release-v2.0.0",
      date: "2026-11-20",
      title: "Second release",
      hasNotes: true,
    });
    expect(entries[1]).toEqual({
      tag: "v1.0.0",
      id: "release-v1.0.0",
      date: "2026-11-10",
      isoDate: "2026-11-10T09:00:00+00:00",
      title: null,
      summary: null,
      blocks: [],
      hasNotes: false,
    });
  });

  it("fetches tags in a shallow clone that omitted tags, and fails loudly when no tags exist", () => {
    const originDir = makeTempDir("origin-");
    git(["init", "-b", "main"], originDir);
    git(["config", "user.email", "test@mellodifai.local"], originDir);
    git(["config", "user.name", "Test"], originDir);

    writeFileSync(join(originDir, "a.txt"), "one\n", "utf8");
    git(["add", "a.txt"], originDir);
    git(["commit", "-m", "first"], originDir);
    git(["tag", "-a", "v0.1.0", "-m", "First tag"], originDir);

    writeFileSync(join(originDir, "a.txt"), "two\n", "utf8");
    git(["add", "a.txt"], originDir);
    git(["commit", "-m", "second"], originDir);
    git(["tag", "v0.2.0"], originDir);

    // Clone shallow with --no-tags, mimicking actions/checkout@v4 default shallow checkout.
    const shallowDir = makeTempDir("shallow-");
    rmSync(shallowDir, { recursive: true, force: true });
    git(
      [
        "clone",
        "--depth=1",
        "--no-tags",
        `file:///${originDir.replaceAll("\\", "/")}`,
        shallowDir,
      ],
      TMP_ROOT,
    );
    expect(git(["tag"], shallowDir).trim()).toBe("");

    // When allowFetch is false on a tagless shallow clone, it must fail clearly (never return []).
    expect(() =>
      collectGitTags({ repoRoot: shallowDir, allowFetch: false }),
    ).toThrow(/git fetch --tags/u);

    // With default allowFetch: true, collectGitTags fetches tags from origin and returns them.
    const fetched = collectGitTags({ repoRoot: shallowDir });
    expect(fetched.map((t) => t.tag)).toEqual(["v0.2.0", "v0.1.0"]);

    // An empty repository with no tags and no remote must fail with a clear error.
    const emptyRepo = makeTempDir("empty-repo-");
    git(["init", "-b", "main"], emptyRepo);
    expect(() => collectGitTags({ repoRoot: emptyRepo })).toThrow(
      /no git tags found/u,
    );
  });

  it("sorts tag lines newest-first and formats dates deterministically in UTC", () => {
    const parsed = parseGitTagLines(
      [
        "older\t2026-11-03T20:00:00+01:00\tcommit",
        "newer\t2026-11-22T18:00:00+01:00\ttag",
      ].join("\n"),
    );
    expect(parsed.map((p) => p.tag)).toEqual(["newer", "older"]);

    expect(formatChangelogDate("2026-11-22T18:09:05+01:00", "en", "long")).toBe(
      "Nov 22, 2026",
    );
    expect(
      formatChangelogDate("2026-11-22T18:09:05+01:00", "en", "short"),
    ).toBe("Nov 22");
    expect(
      formatChangelogDate("2026-11-22T18:09:05+01:00", "it", "long"),
    ).toContain("2026");
  });
});
