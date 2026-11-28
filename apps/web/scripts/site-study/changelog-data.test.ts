// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { formatChangelogDate } from "../../lib/site/changelog-types";
import {
  collectGitTags,
  loadChangelogEntries,
  parseGitTagLines,
  parseSafeMarkdown,
  readTagSnapshot,
  sanitizeMarkdownHref,
  tagToAnchorId,
  writeTagSnapshot,
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

function git(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tarBinary(): string {
  if (process.platform === "win32") {
    return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  }
  return "tar";
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

describe("changelog-data: git tags, archive snapshot, CI fetch, and tie-break order", () => {
  it("reads every live git tag in git for-each-ref order without a committed snapshot and joins markdown notes", () => {
    const liveTags = git(
      [
        "for-each-ref",
        "--sort=-creatordate",
        "--format=%(refname:short)",
        "refs/tags",
      ],
      REPO_ROOT,
    )
      .split(/\r?\n/u)
      .map((t) => t.trim())
      .filter(Boolean);
    expect(liveTags.length).toBeGreaterThanOrEqual(11);

    // content/changelog/tags.json is generated on demand for .git-less copies and never committed.
    expect(
      git(["ls-files", "content/changelog/tags.json"], REPO_ROOT).trim(),
    ).toBe("");
    expect(
      git(["check-ignore", "content/changelog/tags.json"], REPO_ROOT).trim(),
    ).toBe("content/changelog/tags.json");

    const entries = loadChangelogEntries({ repoRoot: REPO_ROOT });
    expect(entries.map((e) => e.tag)).toEqual(liveTags);

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

  it("builds in an extracted git archive without .git using content/changelog/tags.json (exit 0, identical entries)", () => {
    const archiveDir = makeTempDir("archive-");
    const tarFile = join(archiveDir, "head.tar");
    const extracted = join(archiveDir, "app");
    mkdirSync(extracted, { recursive: true });

    git(["archive", "--format=tar", "-o", tarFile, "HEAD"], REPO_ROOT);
    execFileSync(tarBinary(), ["-xf", tarFile, "-C", extracted], {
      stdio: "pipe",
    });
    rmSync(tarFile);

    // Ensure the extracted archive has no .git directory or file.
    expect(existsSync(join(extracted, ".git"))).toBe(false);

    // Stage the current tag snapshot and changelog script (mirrors apps/windows/src/build.mjs).
    const snapshotTarget = join(extracted, "content", "changelog", "tags.json");
    writeTagSnapshot({ repoRoot: REPO_ROOT, outPath: snapshotTarget });
    copyFileSync(
      join(
        REPO_ROOT,
        "apps",
        "web",
        "scripts",
        "site-study",
        "changelog-data.mjs",
      ),
      join(
        extracted,
        "apps",
        "web",
        "scripts",
        "site-study",
        "changelog-data.mjs",
      ),
    );

    // Running the data step CLI inside the .git-less extracted archive exits 0 with identical entries.
    const cliStdout = execFileSync(
      process.execPath,
      [
        join(
          extracted,
          "apps",
          "web",
          "scripts",
          "site-study",
          "changelog-data.mjs",
        ),
      ],
      { cwd: extracted, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const archiveEntries = JSON.parse(cliStdout);
    const repoEntries = loadChangelogEntries({ repoRoot: REPO_ROOT });
    expect(archiveEntries).toEqual(repoEntries);

    // Removing tags.json from a .git-less folder must fail loudly (never return []).
    rmSync(snapshotTarget);
    expect(() => collectGitTags({ repoRoot: extracted })).toThrow(
      /missing tag snapshot/u,
    );

    // An empty tags array in tags.json must also fail loudly.
    writeFileSync(snapshotTarget, JSON.stringify({ tags: [] }), "utf8");
    expect(() => readTagSnapshot(snapshotTarget)).toThrow(/zero entries/u);
  }, 15_000);

  it("always reads live git tags when .git exists even under CI=true with a stale or missing tags.json", () => {
    const repoDir = makeTempDir("new-tag-ci-");
    git(["init", "-b", "main"], repoDir);
    git(["config", "user.email", "test@mellodifai.local"], repoDir);
    git(["config", "user.name", "Test"], repoDir);

    writeFileSync(join(repoDir, "a.txt"), "one\n", "utf8");
    git(["add", "a.txt"], repoDir);
    git(["commit", "-m", "first"], repoDir, {
      GIT_AUTHOR_DATE: "2026-11-10T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-11-10T10:00:00Z",
    });
    git(["tag", "v1.0.0"], repoDir);

    // Write an older snapshot, then add a brand-new release tag without refreshing tags.json.
    const staleSnapshot = join(repoDir, "content", "changelog", "tags.json");
    writeTagSnapshot({ repoRoot: repoDir, outPath: staleSnapshot });

    writeFileSync(join(repoDir, "a.txt"), "two\n", "utf8");
    git(["add", "a.txt"], repoDir);
    git(["commit", "-m", "second"], repoDir, {
      GIT_AUTHOR_DATE: "2026-11-26T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-11-26T10:00:00Z",
    });
    git(["tag", "-a", "v2.0.0-new", "-m", "Fresh tag"], repoDir, {
      GIT_COMMITTER_DATE: "2026-11-26T10:00:00Z",
    });

    const prevCi = process.env.CI;
    try {
      process.env.CI = "true";
      // With a stale snapshot present, CI=true still reads live git tags and includes the new tag.
      const tagsWithStale = collectGitTags({
        repoRoot: repoDir,
        snapshotPath: staleSnapshot,
      });
      expect(tagsWithStale.map((t) => t.tag)).toEqual(["v2.0.0-new", "v1.0.0"]);

      // With no snapshot file at all, CI=true still succeeds from live git tags.
      rmSync(staleSnapshot);
      const tagsWithoutSnapshot = collectGitTags({
        repoRoot: repoDir,
        snapshotPath: staleSnapshot,
      });
      expect(tagsWithoutSnapshot.map((t) => t.tag)).toEqual([
        "v2.0.0-new",
        "v1.0.0",
      ]);
    } finally {
      if (prevCi === undefined) delete process.env.CI;
      else process.env.CI = prevCi;
    }
  }, 15_000);

  it("never calls git fetch in the data step, fails loudly on tagless shallow clones, and CI fetches tags explicitly", () => {
    const originDir = makeTempDir("origin-");
    git(["init", "-b", "main"], originDir);
    git(["config", "user.email", "test@mellodifai.local"], originDir);
    git(["config", "user.name", "Test"], originDir);

    writeFileSync(join(originDir, "a.txt"), "one\n", "utf8");
    git(["add", "a.txt"], originDir);
    git(["commit", "-m", "first"], originDir, {
      GIT_AUTHOR_DATE: "2026-11-10T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-11-10T10:00:00Z",
    });
    git(["tag", "-a", "v0.1.0", "-m", "First tag"], originDir, {
      GIT_COMMITTER_DATE: "2026-11-10T10:00:00Z",
    });

    writeFileSync(join(originDir, "a.txt"), "two\n", "utf8");
    git(["add", "a.txt"], originDir);
    git(["commit", "-m", "second"], originDir, {
      GIT_AUTHOR_DATE: "2026-11-20T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-11-20T10:00:00Z",
    });
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

    // collectGitTags must fail loudly and MUST NOT run git fetch against origin.
    expect(() => collectGitTags({ repoRoot: shallowDir })).toThrow(
      /no git tags found/u,
    );
    expect(git(["tag"], shallowDir).trim()).toBe("");

    // Spy confirms the data step only runs for-each-ref and never invokes fetch.
    const spyGit = vi.fn().mockReturnValue("");
    expect(() =>
      collectGitTags({
        repoRoot: shallowDir,
        runGit: spyGit,
      }),
    ).toThrow(/no git tags found/u);
    expect(spyGit).toHaveBeenCalledTimes(1);
    expect(spyGit.mock.calls[0][0][0]).toBe("for-each-ref");

    // Running the explicit CI fetch command populates tags without full history.
    git(
      ["fetch", "--no-tags", "--depth=1", "origin", "+refs/tags/*:refs/tags/*"],
      shallowDir,
    );
    const afterFetch = collectGitTags({ repoRoot: shallowDir });
    expect(afterFetch.map((t) => t.tag)).toEqual(["v0.2.0", "v0.1.0"]);

    // Verify CI workflow fetches tags explicitly instead of relying on actions/checkout fetch-tags.
    const ciYaml = readFileSync(
      join(REPO_ROOT, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    expect(ciYaml).toContain(
      'git fetch --no-tags --depth=1 origin "+refs/tags/*:refs/tags/*"',
    );
    expect(ciYaml).not.toMatch(/fetch-tags:\s*true/u);

    // An empty repository with no tags and no remote fails clearly.
    const emptyRepo = makeTempDir("empty-repo-");
    git(["init", "-b", "main"], emptyRepo);
    expect(() => collectGitTags({ repoRoot: emptyRepo })).toThrow(
      /no git tags found/u,
    );
  }, 15_000);

  it("preserves git's exact tag tie-break order (refname ascending on identical creatordate)", () => {
    const tieRepo = makeTempDir("tie-order-");
    git(["init", "-b", "main"], tieRepo);
    git(["config", "user.email", "test@mellodifai.local"], tieRepo);
    git(["config", "user.name", "Test"], tieRepo);

    writeFileSync(join(tieRepo, "a.txt"), "same commit\n", "utf8");
    git(["add", "a.txt"], tieRepo);
    git(["commit", "-m", "base"], tieRepo);
    // Two lightweight tags on the same commit share the exact same creatordate.
    git(["tag", "zeta-tie"], tieRepo);
    git(["tag", "alpha-tie"], tieRepo);

    const gitOrder = git(
      [
        "for-each-ref",
        "--sort=-creatordate",
        "--format=%(refname:short)",
        "refs/tags",
      ],
      tieRepo,
    )
      .split(/\r?\n/u)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(gitOrder).toEqual(["alpha-tie", "zeta-tie"]);

    const collected = collectGitTags({ repoRoot: tieRepo });
    expect(collected.map((t) => t.tag)).toEqual(gitOrder);

    // parseGitTagLines preserves git's emitted order without re-sorting ties.
    const parsed = parseGitTagLines(
      [
        "alpha-tie\t2026-11-22T18:00:00+01:00\tcommit",
        "zeta-tie\t2026-11-22T18:00:00+01:00\tcommit",
        "older\t2026-11-03T20:00:00+01:00\tcommit",
      ].join("\n"),
    );
    expect(parsed.map((p) => p.tag)).toEqual([
      "alpha-tie",
      "zeta-tie",
      "older",
    ]);

    expect(formatChangelogDate("2026-11-22T18:09:05+01:00", "en", "long")).toBe(
      "Nov 22, 2026",
    );
    expect(
      formatChangelogDate("2026-11-22T18:09:05+01:00", "en", "short"),
    ).toBe("Nov 22");
    expect(
      formatChangelogDate("2026-11-22T18:09:05+01:00", "it", "short"),
    ).toBe("22 nov");
    expect(
      formatChangelogDate("2026-11-22T18:09:05+01:00", "it", "long"),
    ).toContain("2026");
  });
});
