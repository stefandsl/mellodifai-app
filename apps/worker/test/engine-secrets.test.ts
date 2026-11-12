import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { Engine, type Spawn } from "../src/engine.js";
import { workerTempDir } from "../src/runtime.js";
import { loadSecrets } from "../src/secrets.js";

it("parses exported quoted CRLF values and redacts only file values and the service key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-secrets-"));
  try {
    const file = join(dir, "fixture.env");
    await writeFile(
      file,
      "export TOKEN=\"long-file-secret\"\r\nOTHER='other-file-secret'\r\nSHORT=abc\r\n",
    );
    const secrets = await loadSecrets({
      WORKER_ENV_FILES: file,
      PATH: "ordinary-path-value",
      SUPABASE_SERVICE_ROLE_KEY: "service-key-value",
    });
    expect(secrets.values.TOKEN).toBe("long-file-secret");
    expect(
      secrets.redact(
        "long-file-secret other-file-secret ordinary-path-value service-key-value abc",
      ),
    ).toBe("*** *** ordinary-path-value *** abc");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.each(["python", "python.exe", "py", "C:\\Python\\python.exe"])(
  "enforces isolated UTF-8 Python arguments for %s",
  async (command) => {
    const spawn = vi.fn<Spawn>(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    await new Engine({ spawn, log: async () => {} })
      .withWorkspace("workspace")
      .run(command, ["-I", "script.py"], {
        env: { TMP: "wrong", PYTHONIOENCODING: "wrong" },
      });
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "-I",
      "-B",
      "-X",
      "utf8",
      "script.py",
    ]);
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({
      shell: false,
      env: {
        ENGINE_WORKSPACE: "workspace",
        TMP: workerTempDir(),
        TEMP: workerTempDir(),
        TMPDIR: workerTempDir(),
        PYTHONIOENCODING: "utf-8",
      },
    });
  },
);

it.each(["npx", "npx.cmd", "C:\\tools\\npm.cmd"])(
  "rejects shell-dependent command %s before spawn",
  async (command) => {
    const spawn = vi.fn<Spawn>();
    await expect(
      new Engine({ spawn, log: async () => {} }).run(command, ["remotion"]),
    ).rejects.toThrow("CLI js");
    expect(spawn).not.toHaveBeenCalled();
  },
);

it("catches failed async log delivery and drains trailing output", async () => {
  const report = vi.fn();
  const log = vi.fn().mockRejectedValue(new Error("offline"));
  const spawn: Spawn = () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
    });
    queueMicrotask(() => {
      child.stdout.write("line\nlast");
      child.emit("close", 0);
    });
    return child;
  };
  await expect(
    new Engine({ spawn, log, report }).run("tool", []),
  ).rejects.toThrow("log delivery");
  expect(log.mock.calls).toEqual([["line"], ["last"]]);
  expect(report).toHaveBeenCalled();
});

it("hands a child only the secrets the caller names, and still redacts its output", async () => {
  const spawn = vi.fn<Spawn>(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
    });
    queueMicrotask(() => {
      child.stdout.write("key is groq-secret-value\n");
      child.emit("close", 0);
    });
    return child;
  });
  const secrets = {
    values: {
      GROQ_API_KEY: "groq-secret-value",
      OTHER_API_KEY: "other-secret-value",
    },
    redact: (text: string) => text.replaceAll("groq-secret-value", "***"),
  };
  const log = vi.fn(async () => {});
  const engine = new Engine({
    spawn,
    log,
    secrets,
    validateEntries: async () => true,
  });
  await engine.run("tool", []);
  await engine.run("tool", [], {
    secretEnv: ["GROQ_API_KEY"],
    entryIds: ["entry-1"],
  });
  const envs = spawn.mock.calls.map((call) => call[2].env ?? {});
  expect(envs[0]).not.toHaveProperty("GROQ_API_KEY");
  expect(envs[1]).toMatchObject({ GROQ_API_KEY: "groq-secret-value" });
  expect(envs[1]).not.toHaveProperty("OTHER_API_KEY");
  expect(log).toHaveBeenCalledWith("key is ***");
});

it.each([
  "KIE_API_KEY",
  "OPENROUTER_API_KEY",
  "LYRICS_OPENROUTER_KEY",
  "GROQ_API_KEY",
  "HIGGSFIELD_API_KEY",
])("refuses a paid secretEnv without entry ids: %s", async (name) => {
  const spawn = vi.fn<Spawn>();
  const engine = new Engine({ spawn, log: async () => {} });
  await expect(engine.run("tool", [], { secretEnv: [name] })).rejects.toThrow(
    /spend entry/u,
  );
  expect(spawn).not.toHaveBeenCalled();
});

it("accepts several entry ids", async () => {
  const spawn = vi.fn<Spawn>(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
  const validateEntries = vi.fn(async () => true);
  await new Engine({ spawn, validateEntries, log: async () => {} }).run(
    "tool",
    [],
    {
      secretEnv: ["GROQ_API_KEY"],
      entryIds: ["take-1-entry", "take-2-entry"],
    },
  );
  expect(spawn).toHaveBeenCalledOnce();
  expect(validateEntries).toHaveBeenCalledWith(
    ["take-1-entry", "take-2-entry"],
    ["groq"],
  );
});

it.each(["options", "dependencies", "process"] as const)(
  "authorizes paid keys from the %s environment before spawning",
  async (source) => {
    const spawn = vi.fn<Spawn>(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    const env = { GROQ_API_KEY: "test-groq-value" };
    const validateEntries = vi.fn(async () => true);
    if (source === "process") vi.stubEnv("GROQ_API_KEY", env.GROQ_API_KEY);
    try {
      const engine = new Engine({
        spawn,
        log: async () => {},
        validateEntries,
        ...(source === "dependencies" ? { env } : {}),
      });
      const options = source === "options" ? { env } : {};
      await expect(engine.run("tool", [], options)).rejects.toThrow(
        /spend entry/u,
      );
      expect(spawn).not.toHaveBeenCalled();
      await engine.run("tool", [], { ...options, entryIds: ["entry"] });
      expect(validateEntries).toHaveBeenCalledWith(["entry"], ["groq"]);
      expect(spawn.mock.calls[0]?.[2].env).toMatchObject(env);
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

it.each([undefined, async () => false])(
  "rejects unverified or non-open entry IDs",
  async (validateEntries) => {
    const spawn = vi.fn<Spawn>();
    const engine = new Engine({
      spawn,
      log: async () => {},
      ...(validateEntries ? { validateEntries } : {}),
    });
    await expect(
      engine.run("tool", [], {
        secretEnv: ["GROQ_API_KEY"],
        entryIds: ["invented-entry"],
      }),
    ).rejects.toThrow(/spend entry/u);
    expect(spawn).not.toHaveBeenCalled();
  },
);

it.each([
  ["GROQ_API_KEY", "credit"],
  ["KIE_API_KEY", "generate"],
])("rejects a free credit grant for %s and %s", async (key, operation) => {
  const spawn = vi.fn<Spawn>();
  await expect(
    new Engine({ spawn, log: async () => {} }).run(
      "node",
      ["tools/kie.mjs", operation],
      {
        secretEnv: [key],
        freeCall: "kie:credit",
      },
    ),
  ).rejects.toThrow(/spend entry/u);
  expect(spawn).not.toHaveBeenCalled();
});

it("accepts a named free call and refuses an unknown or blank authorization", async () => {
  const spawn = vi.fn<Spawn>(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
  const engine = new Engine({ spawn, log: async () => {} });
  await engine.run("node", ["tools/kie.mjs", "credit"], {
    secretEnv: ["KIE_API_KEY"],
    freeCall: "kie:credit",
  });
  await expect(
    engine.run("tool", [], {
      secretEnv: ["KIE_API_KEY"],
      entryIds: [" "],
    }),
  ).rejects.toThrow(/spend entry/u);
  await expect(
    engine.run("tool", [], {
      secretEnv: ["KIE_API_KEY"],
      freeCall: "unknown" as "kie:credit",
    }),
  ).rejects.toThrow(/spend entry/u);
  expect(spawn).toHaveBeenCalledOnce();
});

it("a child sees MELLODIFAI_ENV_ONLY=1 set after childEnvironment", async () => {
  const spawn = vi.fn<Spawn>(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
  await new Engine({ spawn, log: async () => {} }).run("tool", [], {
    env: { MELLODIFAI_ENV_ONLY: "0" },
  });
  expect(spawn.mock.calls[0]?.[2].env).toMatchObject({
    MELLODIFAI_ENV_ONLY: "1",
  });
});

it("ENGINE_ROOT follows MELLODIFAI_ENGINE_ROOT", async () => {
  const previous = process.env.MELLODIFAI_ENGINE_ROOT;
  process.env.MELLODIFAI_ENGINE_ROOT = "G:/engines/test-root";
  vi.resetModules();
  try {
    const { ENGINE_ROOT } = await import("../src/stages/utils.js");
    expect(ENGINE_ROOT).toBe("G:/engines/test-root");
  } finally {
    if (previous === undefined) delete process.env.MELLODIFAI_ENGINE_ROOT;
    else process.env.MELLODIFAI_ENGINE_ROOT = previous;
    vi.resetModules();
  }
});
