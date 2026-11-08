import { createServer } from "node:http";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { request } from "../src/client.js";
import { bridge } from "../src/mcp.js";

const pat = "mdf_test_fixture_not_a_real_token";
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function fake(status = 200) {
  const received: {
    path: string;
    auth: string;
    key: string | undefined;
    body: Record<string, unknown>;
  }[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    received.push({
      path: req.url ?? "",
      auth: req.headers.authorization ?? "",
      key: req.headers["idempotency-key"] as string | undefined,
      body,
    });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        status === 401
          ? {
              error: {
                code: "unauthorized",
                message: "Authentication required",
              },
            }
          : req.url === "/api/mcp"
            ? { jsonrpc: "2.0", id: body.id, result: { tools: [] } }
            : { data: { jobs: [] } },
      ),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return {
    credentials: { url: `http://127.0.0.1:${address.port}`, pat },
    received,
  };
}
async function rpc(
  credentials: { url: string; pat: string },
  message: unknown,
) {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk;
  });
  await bridge(
    Readable.from([`${JSON.stringify(message)}\n`]),
    output,
    credentials,
  );
  return text ? JSON.parse(text) : null;
}

describe("transports", () => {
  it("the stdio bridge forwards JSON-RPC to /api/mcp with the PAT", async () => {
    const { credentials, received } = await fake();
    const message = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    expect(await rpc(credentials, message)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    });
    expect(received).toMatchObject([
      { path: "/api/mcp", auth: `Bearer ${pat}`, body: message },
    ]);
  });
  it("a revoked PAT yields a JSON-RPC error carrying unauthorized", async () => {
    const { credentials } = await fake(401);
    expect(
      await rpc(credentials, {
        jsonrpc: "2.0",
        id: "request",
        method: "tools/list",
      }),
    ).toMatchObject({
      jsonrpc: "2.0",
      id: "request",
      error: { data: { code: "unauthorized" } },
    });
  });
  it("reports an interrupted read as internal, not ambiguous spend", async () => {
    const { credentials } = await fake();
    const server = servers[0];
    server?.removeAllListeners("request");
    server?.on("request", (req) => req.socket.destroy());
    expect(
      await rpc(credentials, { jsonrpc: "2.0", id: 6, method: "tools/list" }),
    ).toMatchObject({ error: { data: { code: "internal" } } });
  });
  it("spend commands always send an idempotency key", async () => {
    const { credentials, received } = await fake();
    for (const path of [
      "/songs",
      "/songs/v/lyrics/approve",
      "/songs/v/generate",
      "/songs/v/video",
    ]) {
      await request(credentials, path, {});
    }
    expect(
      received.every(
        (req) => req.key && req.key.length >= 8 && req.key.length <= 100,
      ),
    ).toBe(true);
    expect(new Set(received.map((req) => req.key)).size).toBe(4);
  });
  it.each([
    "song_create",
    "lyrics_approve",
    "lyrics_back",
    "song_generate_again",
    "take_pick",
    "video_make",
    "video_rerender",
    "video_approve",
    "stage_retry",
    "job_cancel",
    "stems_request",
    "visualizer_request",
  ])("sends a key for the Key=yes MCP operation %s", async (name) => {
    const { credentials, received } = await fake();
    await rpc(credentials, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: {} },
    });
    const args = (
      received[0]?.body.params as
        | { arguments: { idempotency_key: string } }
        | undefined
    )?.arguments;
    expect(args?.idempotency_key).toMatch(/^[\w-]{8,100}$/);
  });
  it("preserves explicit keys and never retries ambiguous spend", async () => {
    const { credentials, received } = await fake();
    await request(credentials, "/songs", {}, "stable-operation-key");
    expect(received[0]?.key).toBe("stable-operation-key");
    await rpc(credentials, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "video_make",
        arguments: { idempotency_key: "stable-operation-key" },
      },
    });
    expect(received[1]?.body).toMatchObject({
      params: { arguments: { idempotency_key: "stable-operation-key" } },
    });
    const server = servers[0];
    server?.removeAllListeners("request");
    let calls = 0;
    server?.on("request", (_req, res) => {
      calls++;
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "ambiguous_spend", message: "Check status" },
        }),
      );
    });
    await expect(request(credentials, "/songs", {})).rejects.toMatchObject({
      code: "ambiguous_spend",
    });
    expect(calls).toBe(1);
  });
  it("does not answer notifications, and recovers after malformed input", async () => {
    const { credentials } = await fake();
    expect(
      await rpc(credentials, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    ).toBeNull();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => {
      text += chunk;
    });
    await bridge(
      Readable.from([
        'bad json\n{"jsonrpc":"2.0","id":4,"method":"tools/list"}\n',
      ]),
      output,
      credentials,
    );
    const lines = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[0].error.code).toBe(-32700);
    expect(lines[1].id).toBe(4);
  });

  it("refuses invalid keys before sending a mutation", async () => {
    const { credentials, received } = await fake();
    await expect(
      request(credentials, "/songs", {}, "short"),
    ).rejects.toMatchObject({ code: "validation" });
    expect(
      await rpc(credentials, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "take_pick", arguments: { idempotency_key: null } },
      }),
    ).toMatchObject({ error: { data: { code: "validation" } } });
    expect(received).toHaveLength(0);
  });

  it("never forwards credentials on redirects or retries an interrupted mutation", async () => {
    const { credentials, received } = await fake();
    const destination = await fake();
    const server = servers[0];
    server?.removeAllListeners("request");
    server?.on("request", (_req, res) => {
      res.writeHead(307, {
        Location: `${destination.credentials.url}/api/v1/songs`,
      });
      res.end();
    });
    await expect(request(credentials, "/songs", {})).rejects.toMatchObject({
      code: "ambiguous_spend",
    });
    expect(destination.received).toHaveLength(0);
    expect(received).toHaveLength(0);
    server?.removeAllListeners("request");
    let calls = 0;
    server?.on("request", (req) => {
      calls++;
      req.socket.destroy();
    });
    await expect(request(credentials, "/songs", {})).rejects.toMatchObject({
      code: "ambiguous_spend",
    });
    expect(calls).toBe(1);
  });

  it("passes the negotiated MCP version after initialize", async () => {
    const { credentials } = await fake();
    const server = servers[0];
    server?.removeAllListeners("request");
    const versions: (string | string[] | undefined)[] = [];
    server?.on("request", async (req, res) => {
      let text = "";
      for await (const chunk of req) text += chunk;
      const message = JSON.parse(text);
      versions.push(req.headers["mcp-protocol-version"]);
      if (!Object.hasOwn(message, "id")) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result:
            message.method === "initialize"
              ? { protocolVersion: "2025-03-26" }
              : { tools: [] },
        }),
      );
    });
    const input = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ].map((message) => `${JSON.stringify(message)}\n`);
    await bridge(Readable.from(input), new PassThrough(), credentials);
    expect(versions).toEqual([undefined, "2025-03-26", "2025-03-26"]);
  });

  it.each(["interrupted", "malformed", "wrong-id", "missing-result"])(
    "reports ambiguous_spend for a %s mutation reply after successful headers",
    async (failure) => {
      const { credentials } = await fake();
      const server = servers[0];
      server?.removeAllListeners("request");
      let calls = 0;
      server?.on("request", (_req, res) => {
        calls++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.flushHeaders();
        if (failure === "interrupted") {
          res.write('{"jsonrpc":"2.0",');
          setTimeout(() => res.destroy(), 30);
        } else {
          res.end(
            failure === "malformed"
              ? "not JSON"
              : JSON.stringify({
                  jsonrpc: "2.0",
                  id: failure === "wrong-id" ? 99 : 8,
                  ...(failure === "missing-result" ? {} : { result: {} }),
                }),
          );
        }
      });
      for (const name of ["song_create", "take_pick"]) {
        expect(
          await rpc(credentials, {
            jsonrpc: "2.0",
            id: 8,
            method: "tools/call",
            params: { name, arguments: {} },
          }),
        ).toMatchObject({
          id: 8,
          error: { data: { code: "ambiguous_spend" } },
        });
      }
      expect(calls).toBe(2);
      expect(
        await rpc(credentials, { jsonrpc: "2.0", id: 8, method: "tools/list" }),
      ).toMatchObject({ error: { data: { code: "internal" } } });
      expect(calls).toBe(3);
    },
  );
});
