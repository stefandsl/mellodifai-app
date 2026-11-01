import { describe, expect, it } from "vitest";
import {
  activeTake,
  downloadHref,
  downloadName,
  speedLabel,
  stylePhrases,
} from "./now-playing";

describe("stylePhrases", () => {
  it("takes the first phrases of the style, trimmed", () => {
    expect(
      stylePhrases(" pop , dreamy,  synth, female vocals, lo-fi ", 4),
    ).toEqual(["pop", "dreamy", "synth", "female vocals"]);
  });
  it("skips empty parts and handles an empty style", () => {
    expect(stylePhrases("a,, ,b", 4)).toEqual(["a", "b"]);
    expect(stylePhrases("", 4)).toEqual([]);
  });
});

describe("downloadName", () => {
  it("makes a safe file name from the title", () => {
    expect(downloadName("Lunedì: che bello?", "https://s/x/a.mp3?t=1")).toBe(
      "Lunedì che bello.mp3",
    );
    expect(downloadName('a/bc*d"e', "https://s/x/a.mp3")).toBe("abcde.mp3");
  });
  it("keeps the extension of the file and falls back to mp3 and a name", () => {
    expect(downloadName("Song", "https://s/x/a.flac")).toBe("Song.flac");
    expect(downloadName("Song", "https://s/x/a")).toBe("Song.mp3");
    expect(downloadName("   ", "https://s/x/a.mp3")).toBe("mellodifai.mp3");
  });
  it("keeps a long title within a reasonable length", () => {
    expect(downloadName("x".repeat(300), "a.mp3").length).toBeLessThanOrEqual(
      104,
    );
  });
});

describe("downloadHref", () => {
  it("asks the storage to send the file as a download under that name", () => {
    const href = downloadHref(
      "https://s.co/storage/v1/object/sign/p/a.mp3?token=abc",
      "Song.mp3",
    );
    const url = new URL(href);
    expect(url.searchParams.get("token")).toBe("abc");
    expect(url.searchParams.get("download")).toBe("Song.mp3");
  });
  it("keeps the app's own /media link relative", () => {
    expect(downloadHref("/media/p/a.mp3", "Song A.mp3")).toBe(
      "/media/p/a.mp3?download=Song+A.mp3",
    );
    expect(downloadName("Song", "/media/p/a.flac")).toBe("Song.flac");
  });
  it("returns something unparseable unchanged", () => {
    expect(downloadHref("not a url", "x.mp3")).toBe("not a url");
  });
});

describe("activeTake", () => {
  const takes = [
    { id: "a", number: 1, audioUrl: "u1" },
    { id: "b", number: 2, audioUrl: "u2" },
  ];
  it("is the take being previewed, else the chosen one, else the first", () => {
    expect(activeTake({ takes, chosenTakeId: "a", takeNumber: 2 })).toBe(2);
    expect(activeTake({ takes, chosenTakeId: "b" })).toBe(2);
    expect(activeTake({ takes, chosenTakeId: null })).toBe(1);
    expect(activeTake({ takes: [], chosenTakeId: null })).toBeNull();
  });
});

describe("speedLabel", () => {
  it("writes the speed with an x", () => {
    expect(speedLabel(1.5)).toBe("1.5x");
    expect(speedLabel(2)).toBe("2x");
    expect(speedLabel(0.5)).toBe("0.5x");
  });
});
