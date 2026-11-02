import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envFromValues, loadEnv, parseEnvFile } from "./env.js";
import { runtimeRoot } from "./paths.js";

// Scratch files live under the runtime root (E:), never in the C: temp folder.
function scratch() {
  const root = join(runtimeRoot(), "tmp");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "remake-env-"));
}

describe("env files", () => {
  it("parses quotes, export prefixes and comments", () => {
    expect(
      parseEnvFile("# c\nexport A=\"x y\"\nB='z'\nC = plain\n# D=no\n"),
    ).toEqual({ A: "x y", B: "z", C: "plain" });
  });

  it("reads the worker's WORKER_ENV_FILES, files first, and redacts their values", async () => {
    const dir = scratch();
    const a = join(dir, "a.env");
    const b = join(dir, "b.env");
    writeFileSync(a, "OPENROUTER_API_KEY=first-value-123\n");
    writeFileSync(
      b,
      "OPENROUTER_API_KEY=second-value-456\nGROQ_API_KEY=groq-value-789\n",
    );
    const env = await loadEnv({
      WORKER_ENV_FILES: `${a};${b}`,
      OTHER: "from-process",
      OPENROUTER_API_KEY: "process-value-000",
    });
    expect(env.files).toHaveLength(2);
    expect(env.get("OPENROUTER_API_KEY")).toBe("first-value-123");
    expect(env.get("GROQ_API_KEY")).toBe("groq-value-789");
    expect(env.get("OTHER")).toBe("from-process");
    expect(
      env.redact("key first-value-123, groq-value-789, process-value-000"),
    ).toBe("key ***, ***, ***");
  });

  it("has no built-in owner paths: without WORKER_ENV_FILES only the environment counts", async () => {
    const env = await loadEnv({ PATH: "x" });
    expect(env.files).toEqual([]);
    expect(env.get("OPENROUTER_API_KEY")).toBeUndefined();
    expect(() => env.require("OPENROUTER_API_KEY")).toThrow(
      /OPENROUTER_API_KEY is not set .*WORKER_ENV_FILES/u,
    );
  });

  it("fails loudly on a listed file that does not exist", async () => {
    const dir = scratch();
    await expect(
      loadEnv({ WORKER_ENV_FILES: join(dir, "missing.env") }),
    ).rejects.toThrow(/do not exist: .*missing\.env/u);
  });

  it("wraps the worker's own values without reading any file", () => {
    const env = envFromValues(
      { OPENROUTER_API_KEY: "worker-loaded-1", EMPTY: "" },
      { redact: (text) => text.replaceAll("worker-loaded-1", "***") },
    );
    expect(env.require("OPENROUTER_API_KEY")).toBe("worker-loaded-1");
    expect(env.get("EMPTY")).toBeUndefined();
    expect(() => env.require("GROQ_API_KEY")).toThrow(
      /GROQ_API_KEY is not set/u,
    );
    expect(env.redact("a worker-loaded-1 b")).toBe("a *** b");
  });
});
