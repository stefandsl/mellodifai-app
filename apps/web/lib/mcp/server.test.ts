// @vitest-environment node
import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET as pathMetadata } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { GET as rootMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { GET, POST } from "@/app/api/mcp/route";
import { TOKEN_OPS } from "@/lib/ops/registry";
import { requestHash } from "@/lib/ops/run";
import { newPat } from "@/lib/ops/tokens";
import { apiCases, jobId, takeId, versionId } from "@/test/api-cases";
import { buildMcpServer } from "./server";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), callOps: vi.fn() }));
vi.mock("@/lib/db/ops-client", () => ({
  opsSql: () => ({ unsafe: mocks.sql }),
  callOps: mocks.callOps,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function request(method: string, params = {}, token?: string) {
  return new Request("http://127.0.0.1:3219/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function rpc(method: string, params = {}, token = newPat().token) {
  const response = await POST(request(method, params, token));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.has("mcp-session-id")).toBe(false);
  return response.json();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SITE_URL", "http://127.0.0.1:3210");
  mocks.sql.mockResolvedValue([
    { result: { user_id: randomUUID(), token_id: randomUUID() } },
  ]);
  mocks.callOps.mockImplementation(async (name) => ({
    ok: true,
    data:
      name === "idem_begin"
        ? { status: "new" }
        : apiCases.find((row) => row.name === name)?.output,
  }));
});
afterEach(() => vi.unstubAllEnvs());

it("tools/list returns the 7.3 tool names", async () => {
  const { result } = await rpc("tools/list");
  expect(
    result.tools.map((tool: { name: string }) => tool.name).sort(),
  ).toEqual(apiCases.map((row) => row.name).sort());
  for (const def of TOKEN_OPS) {
    const tool = result.tools.find(
      (item: { name: string }) => item.name === def.name,
    );
    expect(tool.inputSchema.type).toBe("object");
    if (def.key) {
      expect(tool.inputSchema.required).toContain("idempotency_key");
      expect(tool.inputSchema.properties.idempotency_key).toMatchObject({
        type: "string",
        minLength: 8,
        maxLength: 100,
      });
    } else {
      expect(tool.inputSchema.properties).not.toHaveProperty("idempotency_key");
    }
  }
});

it("returns operation data as structured content and JSON text", async () => {
  const { result } = await rpc("tools/call", {
    name: "songs_list",
    arguments: {},
  });
  expect(result.structuredContent).toEqual(apiCases[0].output);
  expect(JSON.parse(result.content[0].text)).toEqual({
    data: apiCases[0].output,
  });
  expect(mocks.callOps).toHaveBeenCalledWith("songs_list", [
    expect.objectContaining({ actor_kind: "pat" }),
    null,
    20,
    null,
    false,
  ]);
});

it.each(apiCases)(
  "dispatches $name through its token definition",
  async (row) => {
    const { result } = await rpc("tools/call", {
      name: row.name,
      arguments: {
        ...("body" in row ? row.body : {}),
        ...(row.path.includes("{version_id}") ? { version_id: versionId } : {}),
        ...(row.path.includes("{job_id}") ? { job_id: jobId } : {}),
        ...(row.path.includes("{take_id}") ? { take_id: takeId } : {}),
        ...(row.method === "POST" ? { idempotency_key: randomUUID() } : {}),
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(row.output);
    expect(mocks.callOps.mock.calls.map(([name]) => name)).toEqual(
      row.method === "POST" ? ["idem_begin", row.name] : [row.name],
    );
  },
);

it("a tool error carries the ops code", async () => {
  const error = {
    code: "cap_exceeded",
    message: "Cap exceeded",
    details: { limit: 1 },
  };
  mocks.callOps.mockResolvedValue({ ok: false, ...error });
  const { result } = await rpc("tools/call", {
    name: "songs_list",
    arguments: {},
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual({ error });
  expect(JSON.parse(result.content[0].text)).toEqual({ error });
});

it.each([undefined, "short", "x".repeat(101), 123])(
  "invalid mutation keys preserve validation: %s",
  async (key) => {
    const { result } = await rpc("tools/call", {
      name: "lyrics_back",
      arguments: { version_id: versionId, idempotency_key: key },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("validation");
    expect(mocks.callOps).not.toHaveBeenCalled();
  },
);

it("validates operation input through the shared runner", async () => {
  const { result } = await rpc("tools/call", {
    name: "song_get",
    arguments: { version_id: "bad" },
  });
  expect(result.structuredContent.error.code).toBe("validation");
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("opens idempotency before dispatch and excludes the key from the request hash", async () => {
  const { result } = await rpc("tools/call", {
    name: "lyrics_back",
    arguments: { version_id: versionId, idempotency_key: "mcp-test-key" },
  });
  expect(result.isError).not.toBe(true);
  const ctx = mocks.callOps.mock.calls[0][1][0];
  expect(ctx.idempotency_key).toBe("mcp-test-key");
  expect(ctx.request_hash).toBe(
    requestHash("lyrics_back", { version_id: versionId }),
  );
  expect(mocks.callOps.mock.calls.map(([name]) => name)).toEqual([
    "idem_begin",
    "lyrics_back",
  ]);
  expect(mocks.callOps).toHaveBeenLastCalledWith("lyrics_back", [
    ctx,
    versionId,
  ]);
});

it("preserves replay and retry_after without dispatching a mutation", async () => {
  mocks.callOps.mockResolvedValueOnce({
    ok: true,
    data: {
      status: "replay",
      response: {
        ok: true,
        data: { version_id: versionId, status: "lyrics_review" },
      },
    },
  });
  const params = {
    name: "lyrics_back",
    arguments: { version_id: versionId, idempotency_key: "mcp-replay-key" },
  };
  expect(
    (await rpc("tools/call", params)).result.structuredContent.status,
  ).toBe("lyrics_review");
  mocks.callOps.mockResolvedValueOnce({
    ok: false,
    code: "in_progress",
    message: "In progress",
    retry_after: 2,
  });
  expect(
    (await rpc("tools/call", params)).result.structuredContent.error
      .retry_after,
  ).toBe(2);
  expect(mocks.callOps.mock.calls.map(([name]) => name)).toEqual([
    "idem_begin",
    "idem_begin",
  ]);
});

it("MCP calls share the write rate limit", async () => {
  const token = newPat().token;
  const params = {
    name: "lyrics_back",
    arguments: { version_id: versionId, idempotency_key: "mcp-rate-key" },
  };
  for (let i = 0; i < 10; i++)
    expect((await rpc("tools/call", params, token)).result.isError).not.toBe(
      true,
    );
  expect(
    (await rpc("tools/call", params, token)).result.structuredContent.error,
  ).toMatchObject({ code: "rate_limited", retry_after: expect.any(Number) });
  expect(mocks.callOps).toHaveBeenCalledTimes(20);
});

it("401 carries WWW-Authenticate with resource_metadata", async () => {
  const req = request("tools/list");
  req.headers.set("cookie", "sb-access-token=cookie-session");
  req.headers.set("x-forwarded-host", "attacker.invalid");
  const response = await POST(req);
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe(
    'Bearer resource_metadata="http://127.0.0.1:3212/.well-known/oauth-protected-resource/api/mcp"',
  );
  expect(await response.json()).toMatchObject({
    error: { code: "unauthorized" },
  });
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("resolves OAuth on every POST and rejects a revoked grant", async () => {
  await rpc("tools/list", {}, "opaque-access");
  expect(mocks.sql).toHaveBeenCalledWith(
    "select ops.resolve_access_token($1, $2) as result",
    [expect.any(String), "http://127.0.0.1:3212/api/mcp"],
  );
  mocks.sql.mockRejectedValueOnce(new Error("private database detail"));
  const response = await POST(request("tools/list", {}, "opaque-access"));
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain("private database detail");
});

it("GET answers 405", async () => {
  const response = GET();
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});

it.each(["initialize", "tools/list", "tools/call"])(
  "invalid PATs receive a 401 challenge before %s dispatch",
  async (method) => {
    mocks.sql.mockRejectedValueOnce(new Error("private database refusal"));
    const response = await POST(request(method, {}, "mdf_pat_invalid"));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="http://127.0.0.1:3212/.well-known/oauth-protected-resource/api/mcp"',
    );
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "Authentication required" },
    });
    expect(mocks.callOps).not.toHaveBeenCalled();
  },
);

it("a revoked PAT receives 401 on the next request, including discovery", async () => {
  const token = newPat().token;
  await rpc("tools/list", {}, token);
  mocks.sql.mockRejectedValueOnce(new Error("authentication required"));
  const response = await POST(request("tools/list", {}, token));
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toContain(
    "resource_metadata=",
  );
  expect(mocks.sql).toHaveBeenCalledTimes(2);
  expect(mocks.sql).toHaveBeenLastCalledWith(
    "select ops.resolve_pat($1) as result",
    [
      expect.objectContaining({
        actor_kind: "pat",
        token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ],
  );
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("an invalid PAT resolver response fails closed", async () => {
  mocks.sql.mockResolvedValueOnce([{ result: null }]);
  expect((await POST(request("tools/list", {}, newPat().token))).status).toBe(
    401,
  );
});

it.each(["http://127.0.0.1:3210", "https://app.mellodifai.com"])(
  "both metadata paths use the canonical resource for %s",
  async (site) => {
    vi.stubEnv("SITE_URL", site);
    const origin = site.includes("3210") ? "http://127.0.0.1:3212" : site;
    const expected = {
      resource: `${origin}/api/mcp`,
      authorization_servers: [`${origin}/oauth`],
      scopes_supported: ["read", "create", "spend"],
      bearer_methods_supported: ["header"],
    };
    expect(await rootMetadata().json()).toEqual(expected);
    expect(await pathMetadata().json()).toEqual(expected);
  },
);

it("fails closed without exposing configuration for an unknown origin", async () => {
  vi.stubEnv("SITE_URL", "https://private.invalid");
  for (const response of [
    rootMetadata(),
    pathMetadata(),
    await POST(request("tools/list")),
  ]) {
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal", message: "Internal error" },
    });
  }
});

it("registers the SongDetail resource and uses the token runner to read it", async () => {
  const { result: list } = await rpc("resources/templates/list");
  expect(list.resourceTemplates).toEqual([
    expect.objectContaining({ uriTemplate: "mellodifai://songs/{version_id}" }),
  ]);
  const uri = `mellodifai://songs/${versionId}`;
  const { result } = await rpc("resources/read", { uri });
  expect(result.contents[0]).toMatchObject({
    uri,
    mimeType: "application/json",
  });
  expect(JSON.parse(result.contents[0].text)).toEqual(apiCases[1].output);
  expect(mocks.callOps).toHaveBeenCalledWith("song_get", [
    expect.objectContaining({ actor_kind: "pat" }),
    versionId,
  ]);
  mocks.callOps.mockResolvedValueOnce({
    ok: false,
    code: "not_found",
    message: "Not found",
  });
  expect((await rpc("resources/read", { uri })).error.data.code).toBe(
    "not_found",
  );
});

it("registers new_song with a safe creation workflow", async () => {
  expect(
    (await rpc("prompts/list")).result.prompts.map(
      (p: { name: string }) => p.name,
    ),
  ).toEqual(["new_song"]);
  const { result } = await rpc("prompts/get", { name: "new_song" });
  expect(result.messages[0].content.text).toContain("song_create");
  expect(result.messages[0].content.text).toContain("idempotency_key");
  expect(result.messages[0].content.text).toContain("ambiguous_spend");
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("retains the transport's default 4 MiB body limit", async () => {
  const response = await POST(
    request(
      "tools/list",
      { padding: "x".repeat(4 * 1024 * 1024) },
      newPat().token,
    ),
  );
  expect(response.status).toBe(413);
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("buildMcpServer keeps separate callers' contexts isolated", async () => {
  async function call(hash: string, key: string) {
    const server = buildMcpServer({
      actor_kind: "pat",
      token_hash: hash,
      remote: false,
      request_id: randomUUID(),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(
        request("tools/call", {
          name: "lyrics_back",
          arguments: { version_id: versionId, idempotency_key: key },
        }),
      );
    } finally {
      await server.close();
    }
  }
  const responses = await Promise.all([
    call("one", "first-key"),
    call("two", "second-key"),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(
    mocks.callOps.mock.calls
      .filter(([name]) => name === "lyrics_back")
      .map(([, [ctx]]) => [ctx.token_hash, ctx.idempotency_key])
      .sort(),
  ).toEqual([
    ["one", "first-key"],
    ["two", "second-key"],
  ]);
});
