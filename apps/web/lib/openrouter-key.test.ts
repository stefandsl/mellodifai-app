// @vitest-environment node
import { expect, it } from "vitest";
import { groqKey, openRouterKey } from "./openrouter-key";

const files = (map: Record<string, string>) => async (file: string) => {
  const text = map[file];
  if (text === undefined) throw new Error("ENOENT");
  return text;
};

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

it("reads the worker's env files when the environment has none", async () => {
  const read = files({
    "a.env": "WORKER_ID=x\nexport OPENROUTER_API_KEY='general-key'\n",
    "b.env": 'LYRICS_OPENROUTER_KEY="lyrics-key"\r\n',
  });
  expect(await openRouterKey({ WORKER_ENV_FILES: "a.env;b.env" }, read)).toBe(
    "lyrics-key",
  );
  expect(await openRouterKey({ WORKER_ENV_FILES: "a.env" }, read)).toBe(
    "general-key",
  );
});

it("skips a missing file and returns null when there is no key anywhere", async () => {
  expect(
    await openRouterKey(
      { WORKER_ENV_FILES: "nope.env;a.env" },
      files({ "a.env": "FOO=bar\nOPENROUTER_API_KEY=\n" }),
    ),
  ).toBeNull();
  expect(await openRouterKey({})).toBeNull();
});

it("finds the Groq key for transcriptions the same way", async () => {
  const read = files({ "a.env": "# GROQ_API_KEY=\nGROQ_API_KEY=gsk-test\n" });
  expect(await groqKey({ WORKER_ENV_FILES: "a.env" }, read)).toBe("gsk-test");
  expect(await groqKey({ GROQ_API_KEY: "env" }, read)).toBe("env");
  expect(await groqKey({}, read)).toBeNull();
});
