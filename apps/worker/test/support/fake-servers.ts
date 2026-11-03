import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export type FakeServer = {
  url: string;
  calls: Array<{ path: string; body: unknown }>;
  reply: (path: string, body: unknown) => unknown;
};

async function start(
  reply: (path: string, body: unknown) => unknown,
): Promise<FakeServer & { close(): Promise<void> }> {
  const calls: FakeServer["calls"] = [];
  const fake: FakeServer = { url: "", calls, reply };
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const path = req.url ?? "/";
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      calls.push({ path, body });
      const answer = fake.reply(path, body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer));
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fake server address missing");
  fake.url = `http://127.0.0.1:${address.port}`;
  return Object.assign(fake, {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  });
}

export async function startFakeProviders(): Promise<{
  kie: FakeServer;
  openrouter: FakeServer;
  groq: FakeServer;
  close(): Promise<void>;
}> {
  const kie = await start((path) =>
    path.startsWith("/api/v1/chat/credit")
      ? { code: 200, data: 1000 }
      : path.startsWith("/api/v1/jobs/createTask")
        ? { code: 200, data: { taskId: "fake-task" } }
        : { code: 200, data: { state: "failed" } },
  );
  const openrouter = await start(() => ({
    choices: [{ message: { content: "{}" } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0001 },
  }));
  const groq = await start(() => ({ text: "fake words", duration: 6 }));
  return {
    kie,
    openrouter,
    groq,
    async close() {
      await Promise.all([kie.close(), openrouter.close(), groq.close()]);
    },
  };
}
