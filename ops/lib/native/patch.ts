import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { safeEntryPath } from "./zip.js";

interface Hunk {
  oldStart: number;
  lines: string[];
}
interface FilePatch {
  path: string;
  create: boolean;
  hunks: Hunk[];
}

/** Parse the subset of unified diff the build recipes commit: file creation
 * and in-place edits with a/ and b/ prefixes. Anything else is an error.
 */
export function parsePatch(text: string): FilePatch[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const files: FilePatch[] = [];
  let index = 0;
  // Free-form description before the first file header.
  while (index < lines.length && !lines[index]?.startsWith("--- ")) index++;
  while (index < lines.length) {
    const from = lines[index] as string;
    const to = lines[index + 1] ?? "";
    if (!from.startsWith("--- ") || !to.startsWith("+++ b/"))
      throw new Error("Unsupported patch header");
    const create = from === "--- /dev/null";
    const path = safeEntryPath(to.slice(6));
    if (!path || (!create && from !== `--- a/${to.slice(6)}`))
      throw new Error("Unsupported patch header");
    index += 2;
    const file: FilePatch = { path, create, hunks: [] };
    while (lines[index]?.startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(
        lines[index] as string,
      );
      if (!match) throw new Error("Invalid patch hunk header");
      let oldLeft = Number(match[2] ?? 1);
      let newLeft = Number(match[4] ?? 1);
      const hunk: Hunk = { oldStart: Number(match[1]), lines: [] };
      index++;
      while (oldLeft > 0 || newLeft > 0) {
        const line = lines[index];
        if (line === undefined) throw new Error("Truncated patch hunk");
        const kind = line[0];
        if (kind === " ") {
          oldLeft--;
          newLeft--;
        } else if (kind === "-") oldLeft--;
        else if (kind === "+") newLeft--;
        else throw new Error("Invalid patch hunk line");
        hunk.lines.push(line);
        index++;
      }
      if (oldLeft !== 0 || newLeft !== 0)
        throw new Error("Patch hunk does not match its header");
      file.hunks.push(hunk);
    }
    if (file.hunks.length === 0) throw new Error("Patch file has no hunks");
    files.push(file);
    while (index < lines.length && lines[index] === "") index++;
  }
  if (files.length === 0) throw new Error("Patch contains no files");
  return files;
}

/** Apply with no fuzz and no offset: every context and removed line must sit
 * exactly where the patch says, so a changed upstream file fails the build
 * instead of being edited in the wrong place. All files are checked before
 * the first one is written.
 */
export function applyPatch(root: string, text: string): string[] {
  const results: { target: string; content: string }[] = [];
  for (const file of parsePatch(text)) {
    const target = join(root, file.path);
    if (file.create) {
      if (existsSync(target))
        throw new Error(`Patch would overwrite ${file.path}`);
      const [hunk] = file.hunks;
      if (
        file.hunks.length !== 1 ||
        !hunk ||
        hunk.lines.some((line) => line[0] !== "+")
      )
        throw new Error(`Invalid file creation patch for ${file.path}`);
      results.push({
        target,
        content: `${hunk.lines.map((line) => line.slice(1)).join("\n")}\n`,
      });
      continue;
    }
    if (!existsSync(target))
      throw new Error(`Patch target is missing: ${file.path}`);
    const source = readFileSync(target, "utf8").split("\n");
    const output: string[] = [];
    let cursor = 0;
    for (const hunk of file.hunks) {
      const start = hunk.oldStart - 1;
      if (start < cursor) throw new Error(`Overlapping hunks in ${file.path}`);
      output.push(...source.slice(cursor, start));
      cursor = start;
      for (const line of hunk.lines) {
        const body = line.slice(1);
        if (line[0] === "+") {
          output.push(body);
          continue;
        }
        if (source[cursor] !== body)
          throw new Error(
            `Patch does not apply to ${file.path} at line ${cursor + 1}`,
          );
        if (line[0] === " ") output.push(body);
        cursor++;
      }
    }
    output.push(...source.slice(cursor));
    results.push({ target, content: output.join("\n") });
  }
  for (const { target, content } of results) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return results.map(({ target }) => target);
}
