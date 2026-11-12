import { describe, expect, it } from "vitest";

import { audioExt, audioProblem, titleFromFile } from "./audio-files";
import type { Clip } from "./clips";
import { canRewrite, editPhase, editView, rewriteEngines } from "./rewrite";
import { creditLine, licenceWarning } from "./song-source";
import { isSunoAudio, readSunoPage, sunoLink } from "./suno-link";
import { segmentsToLyrics } from "./transcribe-text";

describe("Suno links", () => {
  it("takes suno.com song and share links only", () => {
    expect(sunoLink("https://suno.com/s/AbCd1234")?.pathname).toBe(
      "/s/AbCd1234",
    );
    expect(
      sunoLink("https://suno.com/song/3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b"),
    ).not.toBeNull();
    for (const bad of [
      "http://suno.com/s/AbCd1234",
      "https://suno.com.evil.test/s/AbCd1234",
      "https://suno.com/@someone",
      "https://example.com/song/3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
      "not a link",
    ])
      expect(sunoLink(bad), bad).toBeNull();
    expect(isSunoAudio("https://cdn1.suno.ai/abc.mp3")).toBe(true);
    expect(isSunoAudio("https://cdn1.suno.ai.evil.test/abc.mp3")).toBe(false);
    expect(isSunoAudio("https://cdn1.suno.ai/abc.wav")).toBe(false);
  });
  it("reads title, author, audio, style and lyrics from the public page", () => {
    const id = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
    const html = `<html><head>
      <meta property="og:title" content="Solo un caff&#x27;è by Stefan | Suno">
      <meta property="og:audio" content="https://cdn1.suno.ai/${id}.mp3">
      <meta property="og:image" content="https://cdn2.suno.ai/image_${id}.jpeg">
      </head><body><script>self.__next_f.push([1,"{\\"tags\\":\\"electro swing, italian\\",\\"prompt\\":\\"[Verse]\\\\nSono le nove\\\\nla prima mail\\"}"])</script></body></html>`;
    expect(readSunoPage(html, `https://suno.com/song/${id}`)).toEqual({
      id,
      title: "Solo un caff'è",
      author: "Stefan",
      audio: `https://cdn1.suno.ai/${id}.mp3`,
      image: `https://cdn2.suno.ai/image_${id}.jpeg`,
      style: "electro swing, italian",
      lyrics: "[Verse]\nSono le nove\nla prima mail",
    });
  });
  it("falls back to Suno's audio address from the song id", () => {
    const id = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
    const song = readSunoPage("<html></html>", `https://suno.com/song/${id}`);
    expect(song.audio).toBe(`https://cdn1.suno.ai/${id}.mp3`);
    expect(song.title).toBeNull();
  });
});

describe("transcription text", () => {
  it("keeps one line per segment, repeats included, without Whisper's filler", () => {
    expect(
      segmentsToLyrics([
        { text: " Solo un caffè " },
        { text: "[Music]" },
        { text: "Solo un caffè" },
        { text: "Grazie per la visione." },
        { text: "  poi si   va " },
      ]),
    ).toBe("Solo un caffè\nSolo un caffè\npoi si va");
  });
});

describe("recordings", () => {
  it("knows MP3, WAV and FLAC by type or by name, up to 50 MB", () => {
    expect(audioExt({ name: "a.bin", type: "audio/x-wav" })).toBe("wav");
    expect(audioExt({ name: "Song.FLAC", type: "" })).toBe("flac");
    expect(audioExt({ name: "a.ogg", type: "audio/ogg" })).toBeNull();
    expect(
      audioProblem({
        name: "a.mp3",
        type: "audio/mpeg",
        size: 50 * 1024 * 1024,
      }),
    ).toBeNull();
    expect(
      audioProblem({
        name: "a.mp3",
        type: "audio/mpeg",
        size: 50 * 1024 * 1024 + 1,
      }),
    ).toBe("tooBig");
    expect(audioProblem({ name: "a.m4a", type: "audio/mp4", size: 1 })).toBe(
      "wrongType",
    );
    expect(titleFromFile("Solo_un_caffè (C-A-F-F-È).mp3")).toBe(
      "Solo un caffè (C-A-F-F-È)",
    );
  });
});

describe("sources and credits", () => {
  it("writes the remix credit of a song made from other audio", () => {
    expect(
      creditLine(
        {
          kind: "cover",
          title: "Bella ciao",
          author: "Tradizionale",
          licence: "public-domain",
        },
        "it",
      ),
    ).toBe("Cover di «Bella ciao» di Tradizionale");
    expect(
      creditLine(
        {
          kind: "reference",
          title: "Night Drive",
          author: "Artist",
          url: "https://example.com/s",
          licence: "cc-by-sa",
        },
        "en",
      ),
    ).toBe(
      "Inspired by «Night Drive» by Artist · CC BY-SA 4.0 · https://example.com/s",
    );
    // The owner's own import needs no credit.
    expect(creditLine({ kind: "suno", licence: "own" }, "it")).toBeNull();
  });
  it("warns before publishing what the licence restricts", () => {
    expect(
      licenceWarning("it", { kind: "cover", licence: "cc-by-nd" }),
    ).toContain("permesso dell'autore");
    expect(
      licenceWarning("it", { kind: "suno", licence: "cc-by-nc" }),
    ).toContain("monetizzazione");
    expect(licenceWarning("it", { kind: "suno", licence: "own" })).toBeNull();
    expect(
      licenceWarning("it", { kind: "cover", licence: "unknown" }),
    ).toContain("verificare");
  });
});

describe("rewrite state", () => {
  const row = {
    id: "e1",
    take_id: "t1",
    engine: "kie" as const,
    start_s: "21.00",
    end_s: "33.50",
    section_lines: [1, 2],
    section_lyrics: "x",
    full_lyrics: "y",
    alternatives: [
      { path: "previews/o/p/it/section-1.mp3", duration: 120 },
      { path: 3 },
    ],
    created_at: "2026-11-01T10:00:00Z",
  };
  it("reads a request with its job and queue place", () => {
    const view = editView(
      row,
      {
        id: "j",
        status: "queued",
        error: null,
        started_at: null,
        edit_id: "e1",
      },
      [{ edit_id: "e1", queue_position: 2 }],
    );
    expect(view).toMatchObject({
      start: 21,
      end: 33.5,
      alternatives: [
        { url: "/media/previews/o/p/it/section-1.mp3", duration: 120 },
      ],
      queuePosition: 2,
    });
    expect(editPhase(view)).toBe("ready");
    expect(editPhase({ ...view, alternatives: [] })).toBe("queued");
    expect(
      editPhase({
        ...view,
        alternatives: [],
        job: { id: "j", status: "running", error: null, startedAt: null },
      }),
    ).toBe("running");
    expect(
      editPhase({
        ...view,
        alternatives: [],
        job: { id: "j", status: "failed", error: "x", startedAt: null },
      }),
    ).toBe("failed");
    expect(editPhase(null)).toBe("none");
  });
  it("offers ACE-Step only to the admin, with the PC online and the feature installed", () => {
    const base = {
      isAdmin: true,
      engines: {
        "ace-step": {
          installed: true,
          passedLangs: ["it" as const],
          minutesPerAudioMinute: 0.8,
          features: ["rewrite" as const],
        },
      },
      lastSeen: "2026-11-01T10:00:00Z",
      now: Date.parse("2026-11-01T10:00:30Z"),
      lang: "it",
    };
    expect(rewriteEngines(base)).toEqual(["kie", "ace-step"]);
    expect(rewriteEngines({ ...base, isAdmin: false })).toEqual(["kie"]);
    expect(rewriteEngines({ ...base, lang: "ja" })).toEqual(["kie"]);
    expect(
      rewriteEngines({ ...base, now: Date.parse("2026-11-01T10:05:00Z") }),
    ).toEqual(["kie"]);
    expect(
      rewriteEngines({
        ...base,
        engines: {
          "ace-step": { ...base.engines["ace-step"], features: [] },
        },
      }),
    ).toEqual(["kie"]);
  });
  it("allows a rewrite only with a current take in the right status", () => {
    const clip = {
      status: "audio_ready",
      trashedAt: null,
      takes: [{ id: "t", number: 1, audioUrl: "/a", scores: null }],
    } as unknown as Clip;
    expect(canRewrite(clip)).toBe(true);
    expect(canRewrite({ ...clip, status: "takes_review" })).toBe(true);
    expect(canRewrite({ ...clip, status: "producing" })).toBe(false);
    expect(canRewrite({ ...clip, trashedAt: "x" })).toBe(false);
    expect(canRewrite({ ...clip, takes: [] })).toBe(false);
  });
});
