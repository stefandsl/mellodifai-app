import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Env } from "./env.js";
import { checkMetadata, classifyYtDlp, RemakeError } from "./errors.js";
import { ingest } from "./ingest.js";
import { runtimeRoot } from "./paths.js";
import type { Run } from "./run.js";

const ENV: Env = {
  files: [],
  get: () => undefined,
  require: () => "x",
  redact: (s) => s,
};

function scratch() {
  const root = join(runtimeRoot(), "tmp");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "remake-errors-"));
}

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof RemakeError ? error.code : "other";
  }
  return null;
};

describe("checkMetadata", () => {
  it.each([
    [{ availability: "private" }, "private"],
    [{ availability: "subscriber_only" }, "private"],
    [{ availability: "needs_auth" }, "age_restricted"],
    [{ age_limit: 18 }, "age_restricted"],
    [{ is_live: true }, "unavailable"],
    [{ live_status: "is_upcoming" }, "unavailable"],
    [{ duration: 481 }, "too_long"],
    [{ duration: 157, availability: "public", age_limit: 0 }, null],
  ])("%j -> %s", (info, code) => {
    expect(codeOf(() => checkMetadata(info))).toBe(code);
  });
});

describe("classifyYtDlp", () => {
  it.each([
    [
      "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
      "private",
    ],
    [
      "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.",
      "age_restricted",
    ],
    [
      "ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader",
      "unavailable",
    ],
    ["ERROR: unable to download webpage: HTTP Error 503", null],
  ])("%s", (output, code) => {
    expect(classifyYtDlp(output)).toBe(code);
  });
});

describe("ingest refusals", () => {
  const runner =
    (info: Record<string, unknown> | { fail: string }): Run =>
    async (command, args) => {
      if ("fail" in info)
        return { code: 1, stdout: "", stderr: String(info.fail) };
      const outArg = args[args.indexOf("-o") + 1] ?? "";
      const dir = outArg.replace(/[\\/][^\\/]*$/u, "");
      if (command === "yt-dlp" && args.includes("--write-info-json"))
        writeFileSync(join(dir, "source.info.json"), JSON.stringify(info));
      return { code: 0, stdout: "", stderr: "" };
    };

  it("stops before any download when the video is too long", async () => {
    const calls: string[][] = [];
    const run: Run = async (command, args, options) => {
      calls.push(args);
      return runner({ duration: 900, title: "Long mix" })(
        command,
        args,
        options,
      );
    };
    await expect(
      ingest("https://youtu.be/dQw4w9WgXcQ", {
        outRoot: scratch(),
        env: ENV,
        run,
      }),
    ).rejects.toMatchObject({ code: "too_long" });
    expect(calls).toHaveLength(1);
  });

  it("turns yt-dlp's private-video error into an actionable code", async () => {
    await expect(
      ingest("dQw4w9WgXcQ", {
        outRoot: scratch(),
        env: ENV,
        run: runner({ fail: "ERROR: [youtube] dQw4w9WgXcQ: Private video" }),
      }),
    ).rejects.toMatchObject({ name: "RemakeError", code: "private" });
  });

  it("keeps unknown yt-dlp failures as plain errors", async () => {
    await expect(
      ingest("dQw4w9WgXcQ", {
        outRoot: scratch(),
        env: ENV,
        run: runner({ fail: "ERROR: HTTP Error 503" }),
      }),
    ).rejects.not.toBeInstanceOf(RemakeError);
  });
});
