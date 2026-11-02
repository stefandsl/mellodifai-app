import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli.js";

describe("parseCliArgs", () => {
  it("defaults to Italian, the fast writer, three rounds and LaBSE", () => {
    expect(parseCliArgs(["https://youtu.be/abc123def45"])).toMatchObject({
      help: false,
      lang: "it",
      country: null,
      writer: "fast",
      rounds: 3,
      embedder: "labse",
      stems: true,
      keepMedia: false,
    });
  });

  it("reads the flags", () => {
    expect(
      parseCliArgs([
        "abc123def45",
        "--lang",
        "ES",
        "--country",
        "mx",
        "--out",
        "E:\\x",
        "--no-stems",
        "--rounds",
        "2",
      ]),
    ).toMatchObject({
      lang: "es",
      country: "MX",
      out: "E:/x",
      stems: false,
      rounds: 2,
    });
  });

  it("shows help without a link and rejects bad values", () => {
    expect(parseCliArgs([]).help).toBe(true);
    expect(() => parseCliArgs(["https://example.com"])).toThrow(
      /not a YouTube/u,
    );
    expect(() => parseCliArgs(["abc123def45", "--rounds", "5"])).toThrow(
      /1 to 3/u,
    );
    expect(() => parseCliArgs(["abc123def45", "--writer", "huge"])).toThrow(
      /fast or strong/u,
    );
  });
});
