import { setTimeout as sleep } from "node:timers/promises";
import { DllInitializationError } from "./diagnostics.js";

/** Only process initialization is retried, never a transaction or whole rotation. */
export async function retryInitialization<T>(
  operation: () => Promise<T>,
  log: (message: string) => void = console.warn,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DllInitializationError)) throw error;
      if (attempt === 3) {
        log("STATUS_DLL_INIT_FAILED: exhausted 3 initialization attempts");
        throw error;
      }
      log(
        `${error.message}\nSTATUS_DLL_INIT_FAILED: initialization attempt ${attempt}/3 failed; retrying in ${attempt * 250}ms. Windows DLL initialization can fail under desktop heap pressure or session/job teardown.`,
      );
      await sleep(attempt * 250);
    }
  }
}
