import { safeFailure } from "../../../lib/native/diagnostics.js";
import { nativeBackup } from "../../../native-backup.js";
import { importArguments, nativeImport } from "../../../native-import.js";
import { prepareImport } from "../../../native-prepare-import.js";

const [action, boundary, ...args] = process.argv.slice(2);
const checkpoint = async (step: string) => {
  if (step !== boundary) return;
  process.send?.({ step, pid: process.pid });
  await new Promise<void>((done) => process.once("message", () => done()));
};
try {
  if (action === "import")
    await nativeImport(importArguments(args), () => {}, checkpoint);
  else if (action === "prepare") await prepareImport(args, checkpoint);
  else await nativeBackup(args, checkpoint);
  process.disconnect?.();
} catch (error) {
  process.send?.({ error: safeFailure(error) });
  process.stderr.write("Maintenance fixture failed\n");
  process.exitCode = 1;
}
