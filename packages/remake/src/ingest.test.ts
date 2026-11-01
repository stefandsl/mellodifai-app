import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Env } from "./env.js";
import { ingest, parseShowinfo, parseVideoId, pickCaptions } from "./ingest.js";
import type { Run } from "./run.js";

describe("parseVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=x", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://example.com/video", null],
  ])("%s", (url, id) => {
    expect(parseVideoId(url)).toBe(id);
  });
});

describe("pickCaptions", () => {
  it("prefers manual captions in the song's language", () => {
    expect(pickCaptions({ subtitles: { de: [], "en-US": [] } }, "en")).toEqual({
      lang: "en-US",
      auto: false,
    });
  });
  it("uses original auto captions, never machine translations", () => {
    expect(
      pickCaptions(
        { automatic_captions: { it: [], "en-orig": [], en: [] } },
        "en",
      ),
    ).toEqual({ lang: "en-orig", auto: true });
    expect(
      pickCaptions({ automatic_captions: { it: [], fr: [] } }, "en"),
    ).toBeNull();
  });
});

describe("parseShowinfo", () => {
  it("reads frame times from ffmpeg showinfo", () => {
    expect(
      parseShowinfo(
        "[Parsed_showinfo_1] n:0 pts:0 pts_time:0 \n n:1 pts:9000 pts_time:3.0031 pos",
      ),
    ).toEqual([0, 3.003]);
  });
});

const ENV: Env = {
  files: [],
  get: (name) => (name === "GROQ_API_KEY" ? "groq-test-key-123" : undefined),
  require: () => "x",
  redact: (s) => s.replaceAll("groq-test-key-123", "***"),
};

// Pretends to be yt-dlp, ffmpeg and whisper_words.py by writing their outputs.
function fakeRunner(opts: { captions: boolean }) {
  const calls: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[] =
    [];
  const runner: Run = async (command, args, options) => {
    calls.push({
      command,
      args,
      ...(options?.env ? { env: options.env } : {}),
    });
    const outArg = args[args.indexOf("-o") + 1] ?? "";
    const dir = outArg.replace(/[\\/][^\\/]*$/u, "");
    if (command === "yt-dlp" && args.includes("--write-info-json"))
      writeFileSync(
        join(dir, "source.info.json"),
        JSON.stringify({
          title: "Night Song",
          uploader: "Some Artist",
          duration: 30,
          license: "Creative Commons Attribution license (reuse allowed)",
          language: "en",
          subtitles: opts.captions ? { en: [] } : {},
        }),
      );
    else if (command === "yt-dlp" && args.includes("--write-subs"))
      writeFileSync(
        join(dir, "source.en.vtt"),
        "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nI walk alone\n",
      );
    else if (command === "yt-dlp" && args.includes("-x"))
      writeFileSync(join(dir, "audio.wav"), "");
    else if (command === "yt-dlp") writeFileSync(join(dir, "video.mp4"), "");
    else if (command === "python") {
      const out = args.at(-1) ?? "";
      writeFileSync(
        out,
        JSON.stringify([
          { word: "hold", start: 1, end: 1.3 },
          { word: "on.", start: 1.3, end: 1.6 },
        ]),
      );
    } else if (command === "ffmpeg") {
      const pattern = args.at(-1) ?? "";
      if (pattern.includes("sheet_"))
        writeFileSync(pattern.replace("%03d", "001"), "");
      else {
        writeFileSync(pattern.replace("%04d", "0001"), "");
        return {
          code: 0,
          stdout: "",
          stderr: "n:0 pts_time:0\nn:1 pts_time:4.5\n",
        };
      }
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

describe("ingest", () => {
  it("downloads with the node JS runtime and builds a manifest from captions", async () => {
    const outRoot = mkdtempSync(join(tmpdir(), "remake-ingest-"));
    const { runner, calls } = fakeRunner({ captions: true });
    const m = await ingest("https://youtu.be/abc123def45", {
      outRoot,
      env: ENV,
      run: runner,
    });
    expect(m.transcript).toEqual({
      source: "captions",
      language: "en",
      lines: [{ start: 1, end: 3, text: "I walk alone" }],
    });
    expect(m.frames.sceneCuts.map((c) => c.t)).toEqual([0, 4.5]);
    expect(m.frames.contactSheets).toHaveLength(1);
    expect(m.license).toContain("Creative Commons");
    for (const c of calls.filter((x) => x.command === "yt-dlp")) {
      expect(c.args.slice(0, 2)).toEqual(["--js-runtimes", "node"]);
      expect(c.args.at(-1)).toBe("https://www.youtube.com/watch?v=abc123def45");
    }
    expect(calls.some((c) => c.command === "python")).toBe(false);
    const saved = JSON.parse(
      await readFile(join(outRoot, "abc123def45", "manifest.json"), "utf8"),
    );
    expect(saved.videoId).toBe("abc123def45");
    expect(
      JSON.parse(
        await readFile(join(outRoot, "abc123def45", "names.json"), "utf8"),
      ),
    ).toEqual(["Some Artist"]);
  });

  it("falls back to Whisper with the key passed only through the child env", async () => {
    const outRoot = mkdtempSync(join(tmpdir(), "remake-ingest-"));
    const { runner, calls } = fakeRunner({ captions: false });
    const m = await ingest("abc123def45", { outRoot, env: ENV, run: runner });
    expect(m.transcript.source).toBe("whisper");
    expect(m.transcript.lines).toEqual([
      { start: 1, end: 1.6, text: "hold on." },
    ]);
    const whisper = calls.find((c) => c.command === "python");
    expect(whisper?.args[1]).toMatch(/whisper_words\.py$/u);
    expect(whisper?.args).not.toContain("groq-test-key-123");
    expect(whisper?.env?.GROQ_API_KEY).toBe("groq-test-key-123");
  });

  it("reuses cached downloads", async () => {
    const outRoot = mkdtempSync(join(tmpdir(), "remake-ingest-"));
    const first = fakeRunner({ captions: true });
    await ingest("abc123def45", { outRoot, env: ENV, run: first.runner });
    const second = fakeRunner({ captions: true });
    await ingest("abc123def45", { outRoot, env: ENV, run: second.runner });
    expect(second.calls).toHaveLength(0);
  });

  it("rejects links that are not YouTube videos", async () => {
    await expect(
      ingest("https://example.com/x", {
        env: ENV,
        run: fakeRunner({ captions: true }).runner,
      }),
    ).rejects.toThrow(/not a YouTube/u);
  });
});
