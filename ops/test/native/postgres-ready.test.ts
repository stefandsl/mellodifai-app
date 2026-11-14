import { createServer, type Socket } from "node:net";
import { expect, it } from "vitest";
import { postgresReady } from "../../lib/native/postgres-ready.js";

async function probe(handler: (socket: Socket) => void, timeout = 500) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () => handler(socket));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const address = server.address() as { port: number };
    return await postgresReady(address.port, timeout);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

it("accepts a fragmented PostgreSQL authentication challenge", async () => {
  expect(
    await probe((socket) => {
      socket.write(Buffer.from([0x52, 0, 0]));
      setTimeout(() => socket.end(Buffer.from([0, 8, 0, 0, 0, 10])), 10);
    }),
  ).toBe(true);
});

it("rejects recovery errors, malformed responses and a listening port without PostgreSQL", async () => {
  expect(
    await probe((s) => s.end(Buffer.from([0x45, 0, 0, 0, 8, 0, 0, 0, 0]))),
  ).toBe(false);
  expect(
    await probe((s) => s.end(Buffer.from([0x52, 0xff, 0xff, 0xff, 0xff]))),
  ).toBe(false);
  expect(await probe(() => {}, 30)).toBe(false);
});
