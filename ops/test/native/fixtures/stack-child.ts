import type { StackEnv } from "../../../lib/envs.js";
import { runStack } from "../../../stack.js";

try {
  await runStack(process.argv[2] as string, process.argv[3] as StackEnv, {
    runtime: "native",
  });
  process.send?.({ ok: true });
} catch (error) {
  process.send?.({ ok: false, message: (error as Error).message });
} finally {
  process.disconnect?.();
}
