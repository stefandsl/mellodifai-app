// @vitest-environment node
import { expect, it, vi } from "vitest";
import { groqKey, openRouterKey } from "./openrouter-key";

const readFile = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ readFile }));

it("prefers the environment, and the lyric pipeline's key over the general one", async () => {
  expect(await openRouterKey({ OPENROUTER_API_KEY: "general" })).toBe(
    "general",
  );
  expect(
    await openRouterKey({
      OPENROUTER_API_KEY: "general",
      LYRICS_OPENROUTER_KEY: "lyrics",
    }),
  ).toBe("lyrics");
});

it("openrouter-key never reads apps/worker/.env.local", async () => {
  readFile.mockClear();
  expect(
    await openRouterKey({ WORKER_ENV_FILES: "apps/worker/.env.local" }),
  ).toBeNull();
  expect(readFile).not.toHaveBeenCalled();
  expect(await openRouterKey({})).toBeNull();
});

it("uses only the web process environment for Groq", async () => {
  readFile.mockClear();
  expect(
    await groqKey({ WORKER_ENV_FILES: "apps/worker/.env.local" }),
  ).toBeNull();
  expect(readFile).not.toHaveBeenCalled();
  expect(await groqKey({ GROQ_API_KEY: "web-key" })).toBe("web-key");
});
