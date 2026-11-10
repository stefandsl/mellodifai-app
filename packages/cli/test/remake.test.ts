import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/commands.js";

const credentials = {
  url: "http://127.0.0.1:3001",
  pat: "mdf_fixture_not_a_real_token",
};
afterEach(() => {
  vi.unstubAllGlobals();
});

type Sent = {
  path: string;
  method: string;
  key: string | null;
  body: Record<string, unknown> | undefined;
};
function stub(reply: (sent: Sent) => unknown = () => ({ data: {} })) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      const entry: Sent = {
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        key: new Headers(init.headers).get("idempotency-key"),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      sent.push(entry);
      const value = reply(entry);
      return value instanceof Response ? value : Response.json(value);
    }),
  );
  return sent;
}
async function cli(args: string[], input: unknown = {}, interval = 0) {
  const output: unknown[] = [];
  await run([...args, "--json"], {
    credentials,
    interval,
    input: async () => input,
    output: (value) => {
      output.push(value);
    },
  });
  return output;
}

describe("remake and take commands", () => {
  it.each([
    [["remakes"], "/api/v1/remakes", "GET"],
    [["remake-status", "r 1"], "/api/v1/remakes/r%201", "GET"],
    [["remake-edit", "r1"], "/api/v1/remakes/r1/lyrics", "POST"],
    [["remake-accept", "r1"], "/api/v1/remakes/r1/accept", "POST"],
    [["remake-cancel", "r1"], "/api/v1/remakes/r1/cancel", "POST"],
    [["remake-retry", "r1"], "/api/v1/remakes/r1/retry", "POST"],
    [["pick", "v1", "t/2"], "/api/v1/songs/v1/takes/t%2F2/pick", "POST"],
    [["approve-video", "v1"], "/api/v1/songs/v1/video/approve", "POST"],
  ])("routes %j to %s with %s", async (args, path, method) => {
    const sent = stub();
    await cli(args, { revision: 3 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe(path);
    expect(sent[0]?.method).toBe(method);
    if (method === "POST") expect(sent[0]?.key).toMatch(/^[\w-]{8,100}$/);
    else expect(sent[0]?.key).toBeNull();
  });

  it("sends the edit and accept files as the body, and empty bodies elsewhere", async () => {
    const sent = stub();
    const accept = {
      revision: 3,
      lyrics_text: "[Verse 1]\nriga",
      title: "Titolo",
      style: "pop",
    };
    await cli(["remake-accept", "r1", "--input", "accept.json"], accept);
    await cli(["remake-cancel", "r1"]);
    await cli(["pick", "v1", "t1"]);
    expect(sent.map((entry) => entry.body)).toEqual([accept, {}, {}]);
  });

  it("starts a remake with lang it by default and passes lang and country", async () => {
    const sent = stub();
    await cli(["remake", "https://youtu.be/dQw4w9WgXcQ"]);
    await cli([
      "remake",
      "dQw4w9WgXcQ",
      "--lang",
      "en",
      "--country",
      "GB",
      "--idempotency-key",
      "stable-remake-key",
    ]);
    expect(sent).toMatchObject([
      {
        path: "/api/v1/remakes",
        method: "POST",
        body: { url: "https://youtu.be/dQw4w9WgXcQ", lang: "it" },
      },
      {
        path: "/api/v1/remakes",
        body: { url: "dQw4w9WgXcQ", lang: "en", country: "GB" },
        key: "stable-remake-key",
      },
    ]);
    expect(sent[0]?.body).not.toHaveProperty("country");
  });

  it("passes remakes filters as a query", async () => {
    const sent = stub();
    await cli(["remakes", "--input", "filters.json"], { limit: 5 });
    expect(sent[0]?.path).toBe("/api/v1/remakes?limit=5");
  });

  it.each([
    [["remake"]],
    [["remake", "a", "b"]],
    [["remake-status"]],
    [["pick", "v1"]],
    [["pick", "v1", "t1", "x"]],
    [["approve-video"]],
    [["remakes", "extra"]],
    [["tools", "extra"]],
    [["call"]],
    [["songs", "--lang", "it"]],
    [["remake-status", "r1", "--country", "IT"]],
    [["remake-edit", "r1", "--watch"]],
    [["toString"]],
    [["login"]],
  ])("refuses %j before any request", async (args) => {
    const sent = stub();
    await expect(cli(args)).rejects.toMatchObject({ code: "validation" });
    expect(sent).toHaveLength(0);
  });
});

describe("remake-status --watch", () => {
  function stages(...replies: Record<string, unknown>[]) {
    let index = 0;
    return stub(() => ({
      data: replies[Math.min(index++, replies.length - 1)],
    }));
  }

  it.each(["accepted", "failed", "cancelled"])(
    "stops when the stage is %s",
    async (stage) => {
      const sent = stages(
        { stage: "ingest", active_job: { status: "running" } },
        { stage: "analyse", active_job: { status: "running" } },
        { stage, active_job: null },
      );
      const output = await cli(["remake-status", "r1", "--watch"]);
      expect(sent).toHaveLength(3);
      expect(output).toHaveLength(3);
    },
  );

  it("keeps polling a review remake while its check job runs, then stops", async () => {
    const sent = stages(
      { stage: "rewrite", active_job: { status: "running" } },
      { stage: "review", active_job: { status: "running", mode: "check" } },
      { stage: "review", active_job: null, accept_ready: true },
    );
    await cli(["remake-status", "r1", "--watch"]);
    expect(sent).toHaveLength(3);
  });

  it("stops at once on a settled review and does not poll without --watch", async () => {
    let sent = stages({ stage: "review", active_job: null });
    await cli(["remake-status", "r1", "--watch"]);
    expect(sent).toHaveLength(1);
    sent = stages({ stage: "ingest", active_job: { status: "queued" } });
    await cli(["remake-status", "r1"]);
    expect(sent).toHaveLength(1);
  });

  it("refuses an unknown stage instead of polling forever", async () => {
    stages({ stage: "mystery" });
    await expect(cli(["remake-status", "r1", "--watch"])).rejects.toMatchObject(
      { code: "internal" },
    );
  });

  it("waits the injected interval, 3 seconds by default", async () => {
    vi.useFakeTimers();
    try {
      const sent = stages(
        { stage: "ingest", active_job: { status: "running" } },
        { stage: "failed", active_job: null },
      );
      const work = run(["remake-status", "r1", "--watch", "--json"], {
        credentials,
        input: async () => ({}),
        output: () => {},
      });
      await vi.advanceTimersByTimeAsync(2999);
      expect(sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await work;
      expect(sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("tools and call", () => {
  const catalog = [
    {
      name: "remake_get",
      description: "Reads one remake.",
      annotations: { readOnlyHint: true },
    },
    {
      name: "remake_start",
      description: "Starts a remake.",
      annotations: { readOnlyHint: false },
    },
    { name: "unannotated" },
  ];
  type Rpc = {
    id: string;
    method: string;
    params: { name?: string; arguments?: Record<string, unknown> };
  };
  function server(call: (message: Rpc) => unknown) {
    return stub((sent) => {
      const message = sent.body as unknown as Rpc;
      if (sent.path !== "/api/mcp") throw new Error("unexpected path");
      return {
        jsonrpc: "2.0",
        id: message.id,
        result:
          message.method === "tools/list" ? { tools: catalog } : call(message),
      };
    });
  }

  it("tools lists every tool as read or write with its description", async () => {
    const sent = server(() => ({}));
    expect(await cli(["tools"])).toEqual([
      {
        data: {
          tools: [
            {
              name: "remake_get",
              access: "read",
              description: "Reads one remake.",
            },
            {
              name: "remake_start",
              access: "write",
              description: "Starts a remake.",
            },
            { name: "unannotated", access: "write", description: null },
          ],
        },
      },
    ]);
    expect(sent).toMatchObject([
      { path: "/api/mcp", method: "POST", body: { method: "tools/list" } },
    ]);
  });

  it("call prints structuredContent and adds a key only to a write tool", async () => {
    const sent = server((message) => ({
      structuredContent: { echo: message.params.arguments },
      content: [],
    }));
    expect(
      await cli(["call", "remake_get", "--input", "args.json"], {
        remake_id: "r1",
      }),
    ).toEqual([{ data: { echo: { remake_id: "r1" } } }]);
    await cli(
      [
        "call",
        "remake_start",
        "--input",
        "args.json",
        "--idempotency-key",
        "stable-call-key",
      ],
      { url: "dQw4w9WgXcQ", lang: "it" },
    );
    await cli(["call", "unannotated"]);
    const calls = sent.filter((entry) => entry.body?.method === "tools/call");
    expect(calls.map((entry) => entry.body?.params)).toEqual([
      { name: "remake_get", arguments: { remake_id: "r1" } },
      {
        name: "remake_start",
        arguments: {
          url: "dQw4w9WgXcQ",
          lang: "it",
          idempotency_key: "stable-call-key",
        },
      },
      {
        name: "unannotated",
        arguments: { idempotency_key: expect.stringMatching(/^[\w-]{8,100}$/) },
      },
    ]);
  });

  it("call rejects with the tool's error code so the CLI exits 1", async () => {
    server(() => ({
      isError: true,
      structuredContent: {
        error: { code: "forbidden_scope", message: "admin required" },
      },
      content: [],
    }));
    await expect(cli(["call", "remake_start"])).rejects.toMatchObject({
      code: "forbidden_scope",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: RequestInit) => {
        const message = JSON.parse(String(init.body));
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32602, message: "Unknown tool" },
        });
      }),
    );
    await expect(cli(["call", "nope"])).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("call reports a lost write reply as ambiguous_spend and a lost read as internal", async () => {
    stub((sent) => {
      const message = sent.body as unknown as Rpc;
      return message.method === "tools/list"
        ? { jsonrpc: "2.0", id: message.id, result: { tools: catalog } }
        : new Response("not JSON", { status: 200 });
    });
    await expect(cli(["call", "remake_start"])).rejects.toMatchObject({
      code: "ambiguous_spend",
    });
    await expect(cli(["call", "remake_get"])).rejects.toMatchObject({
      code: "internal",
    });
  });

  it("call treats the tool as a write when tools/list fails", async () => {
    const sent = stub((entry) => {
      const message = entry.body as unknown as Rpc;
      return message.method === "tools/list"
        ? new Response("{}", { status: 500 })
        : { jsonrpc: "2.0", id: message.id, result: { structuredContent: {} } };
    });
    await cli(["call", "remake_get", "--input", "args.json"], {
      remake_id: "r1",
    });
    expect(sent.map((entry) => entry.body?.method)).toEqual([
      "tools/list",
      "tools/call",
    ]);
    expect(sent[1]?.body).toMatchObject({
      params: {
        name: "remake_get",
        arguments: {
          remake_id: "r1",
          idempotency_key: expect.stringMatching(/^[\w-]{8,100}$/),
        },
      },
    });
  });

  it("call refuses a key that differs from the one in the input", async () => {
    const sent = server(() => ({ structuredContent: {} }));
    await expect(
      cli(
        [
          "call",
          "remake_start",
          "--input",
          "args.json",
          "--idempotency-key",
          "stable-call-key",
        ],
        { idempotency_key: "another-call-key" },
      ),
    ).rejects.toMatchObject({ code: "validation" });
    expect(
      sent.filter((entry) => entry.body?.method === "tools/call"),
    ).toHaveLength(0);
  });
});
