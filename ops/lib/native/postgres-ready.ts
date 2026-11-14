import { connect } from "node:net";

/** Equivalent to pg_isready's no-password probe, without launching libpq and
 * a Windows console helper on every poll. An authentication challenge proves
 * that PostgreSQL accepts startup packets; an open TCP port alone does not. */
export function postgresReady(
  port: number,
  timeoutMs = 3000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    let response = Buffer.alloc(0);
    const done = (ready: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ready);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("error", () => done(false));
    socket.once("end", () => done(false));
    socket.once("connect", () => {
      const fields = Buffer.from(
        "user\0supabase_admin\0database\0postgres\0\0",
      );
      const packet = Buffer.alloc(8 + fields.length);
      packet.writeInt32BE(packet.length);
      packet.writeInt32BE(196608, 4);
      fields.copy(packet, 8);
      socket.write(packet);
    });
    socket.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.length < 5) return;
      const length = response.readInt32BE(1);
      if (length < 4 || length > 65536) return done(false);
      if (response.length < length + 1) return;
      // R = authentication (including trust); E = error, e.g. recovery 57P03.
      done(response[0] === 0x52 && length >= 8);
    });
  });
}
