import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { run } from "../src/commands.js";
import {
  credentialPath,
  loadCredentials,
  saveCredentials,
  validateCredentials,
} from "../src/credentials.js";

const credentials = {
  url: "http://127.0.0.1:3001",
  pat: "mdf_fixture_not_a_real_token",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("stores credentials privately without returning the PAT", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cli-credentials-"));
  const file = join(dir, "credentials.json");
  try {
    await saveCredentials(credentials, file);
    expect(await loadCredentials(file)).toEqual(credentials);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(credentials);
    if (process.platform === "win32") {
      const acl = execFileSync("icacls", [file], { encoding: "utf8" });
      expect(acl).toContain(`${process.env.USERNAME}:(F)`);
      expect(acl).not.toContain("(I)");
      expect(
        acl.split("\n").filter((line) => line.includes(":(F)")).length,
      ).toBe(1);
      await saveCredentials(credentials, file);
      expect(await loadCredentials(file)).toEqual(credentials);
    } else {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      await chmod(file, 0o644);
      await saveCredentials(credentials, file);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("uses APPDATA and refuses insecure credential destinations", () => {
  expect(credentialPath({ APPDATA: "E:/mellodifai/tmp/profile" })).toBe(
    join("E:/mellodifai/tmp/profile", "mellodifai", "credentials.json"),
  );
  for (const url of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/path",
    "file:///tmp",
  ]) {
    expect(() => validateCredentials({ ...credentials, url })).toThrow();
  }
});
it.each([
  ["songs", "/api/v1/songs", "GET"],
  ["costs", "/api/v1/costs", "GET"],
  ["create", "/api/v1/songs", "POST"],
  ["approve", "/api/v1/songs/version/lyrics/approve", "POST"],
  ["regenerate", "/api/v1/songs/version/generate", "POST"],
  ["video", "/api/v1/songs/version/video", "POST"],
])("routes %s to the existing HTTP API", async (command, path, method) => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ data: { jobs: [] } }));
  vi.stubGlobal("fetch", fetcher);
  const output: unknown[] = [];
  await run(
    [
      command,
      ...(command === "approve" ||
      command === "regenerate" ||
      command === "video"
        ? ["version"]
        : []),
      "--json",
    ],
    {
      credentials,
      input: async () => ({}),
      output: (value) => {
        output.push(value);
      },
    },
  );
  expect(new URL(fetcher.mock.calls[0]?.[0]).pathname).toBe(path);
  expect(fetcher.mock.calls[0]?.[1].method).toBe(method);
  expect(output).toEqual([{ data: { jobs: [] } }]);
});
it("watches every three seconds and stops on a terminal job", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ data: { job: { status: "running" }, events: [] } }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: { job: { status: "done" }, events: [] } }),
    );
  vi.stubGlobal("fetch", fetcher);
  const work = run(["status", "job", "--watch", "--json"], {
    credentials,
    input: async () => ({}),
    output: () => {},
  });
  await vi.advanceTimersByTimeAsync(2999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await work;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

import { execFileSync } from "node:child_process";
