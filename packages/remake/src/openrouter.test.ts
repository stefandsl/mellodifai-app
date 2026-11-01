import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv, parseEnvFile } from "./env.js";
import {
  assertNotRedacted,
  createClient,
  parseJsonReply,
  RedactionError,
} from "./openrouter.js";
import { chatReply, fakeFetch } from "./test-fixtures.js";

const KEY = "sk-or-test-0123456789abcdef";

describe("chat", () => {
  it("records the reported cost and sends usage accounting", async () => {
    const { fetchFn, calls } = fakeFetch(() => chatReply("hello", 0.0042));
    const client = createClient({ key: KEY, fetchFn });
    expect(
      await client.chat({ step: "test", model: "m/x", system: "s", user: "u" }),
    ).toBe("hello");
    expect(client.ledger.usd).toBeCloseTo(0.0042);
    expect(client.ledger.calls[0]).toMatchObject({
      step: "test",
      model: "m/x",
      estimated: false,
    });
    expect(calls[0]?.body.usage).toEqual({ include: true });
  });

  it("estimates the cost from the price table when the reply has none", async () => {
    const { fetchFn } = fakeFetch(() => ({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
    }));
    const client = createClient({ key: KEY, fetchFn });
    await client.chat({
      step: "t",
      model: "anthropic/claude-haiku-5.5",
      system: "s",
      user: "u",
    });
    expect(client.ledger.calls[0]).toMatchObject({ usd: 0.1, estimated: true });
  });

  it("fails loudly when the privacy filter replaced words", async () => {
    const { fetchFn } = fakeFetch(() =>
      chatReply({ lines: ["porto [PERSON_NAME] al mare"] }),
    );
    const client = createClient({ key: KEY, fetchFn });
    await expect(
      client.chatJson({ step: "write", model: "m", system: "s", user: "u" }),
    ).rejects.toBeInstanceOf(RedactionError);
  });

  it("retries a server error and never puts the key in errors", async () => {
    let n = 0;
    const { fetchFn } = fakeFetch(() =>
      n++ === 0 ? { status: 503, text: "busy" } : chatReply("ok"),
    );
    const client = createClient({ key: KEY, fetchFn });
    expect(
      await client.chat({ step: "t", model: "m", system: "s", user: "u" }),
    ).toBe("ok");
    const failing = createClient({
      key: KEY,
      fetchFn: fakeFetch(() => ({ status: 401, text: "bad key" })).fetchFn,
    });
    const error = await failing
      .chat({ step: "t", model: "m", system: "s", user: "u" })
      .catch((e: Error) => e);
    expect(String(error)).toContain("401");
    expect(String(error)).not.toContain(KEY);
  });

  it("parses fenced JSON and JSON wrapped in prose", () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Here it is: {"a":2} hope it helps')).toEqual({
      a: 2,
    });
    expect(() => parseJsonReply("no json")).toThrow();
  });

  it("detects every redaction tag kind", () => {
    expect(() => assertNotRedacted("a [LOCATION] b", "x")).toThrow(
      RedactionError,
    );
    expect(() => assertNotRedacted("plain [Chorus] tag", "x")).not.toThrow();
  });
});

describe("embed", () => {
  it("returns vectors in input order", async () => {
    const { fetchFn } = fakeFetch(() => ({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
      usage: { prompt_tokens: 10, cost: 0.000001 },
    }));
    const client = createClient({ key: KEY, fetchFn });
    expect(await client.embed(["a", "b"], "baai/bge-m3")).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });
});

describe("env files", () => {
  it("parses quotes, export prefixes and comments", () => {
    expect(
      parseEnvFile("# c\nexport A=\"x y\"\nB='z'\nC = plain\n# D=no\n"),
    ).toEqual({ A: "x y", B: "z", C: "plain" });
  });

  it("loads the listed files first and redacts their values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "remake-env-"));
    const a = join(dir, "a.env");
    const b = join(dir, "b.env");
    writeFileSync(a, "OPENROUTER_API_KEY=first-value-123\n");
    writeFileSync(
      b,
      "OPENROUTER_API_KEY=second-value-456\nGROQ_API_KEY=groq-value-789\n",
    );
    const env = await loadEnv({
      REMAKE_ENV_FILES: `${a};${b};${join(dir, "missing.env")}`,
      OTHER: "from-process",
    });
    expect(env.files).toHaveLength(2);
    expect(env.get("OPENROUTER_API_KEY")).toBe("first-value-123");
    expect(env.get("GROQ_API_KEY")).toBe("groq-value-789");
    expect(env.get("OTHER")).toBe("from-process");
    expect(env.redact("key first-value-123 and groq-value-789")).toBe(
      "key *** and ***",
    );
    expect(() => env.require("NOPE")).toThrow(/NOPE is not set/u);
  });
});
