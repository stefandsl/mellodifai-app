import { acquireLease } from "../../../lib/native/lease.js";

const [path, command] = process.argv.slice(2);
try {
  const release = await acquireLease(path as string, command as string, 1000);
  process.send?.({ acquired: true, pid: process.pid });
  process.once("message", async () => {
    await release();
    process.exit(0);
  });
} catch (error) {
  process.send?.({ acquired: false, error: (error as Error).message });
  process.exitCode = 1;
  process.disconnect?.();
}
