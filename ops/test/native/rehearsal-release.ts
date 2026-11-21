import { fileURLToPath } from "node:url";
import { readJournal } from "../../lib/native/journal.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { readMigrations } from "../../lib/native/migrate.js";
import { nativeBackup } from "../../native-backup.js";
import {
  rehearsalLedgerHead,
  rehearsalMigrationCount,
} from "../../test-native.js";

// Setup file of every rehearsal test. Rehearsal tests start the rehearsal
// lab's database with this checkout's migrations. A checkout with a migration
// the lab does not have would migrate the lab; restore and import then refuse
// the lab's backups and the recovery data as another schema. Refuse before
// any test touches the lab.
const files = readMigrations(
  fileURLToPath(new URL("../../../supabase/migrations", import.meta.url)),
);
if (rehearsalMigrationCount(files, rehearsalLedgerHead()) !== files.length)
  throw new Error(
    "This checkout has migrations the rehearsal lab does not have. Run the rehearsal tests with pnpm test:native: it stages the release that matches the lab",
  );

// A test that failed between a kill and its recovery leaves an interrupted
// import or restore in the lab. Recover it before the next test: start and
// restore refuse a lab with a pending journal, so one failure would fail
// every later test too.
const pending = readJournal(nativeLayout("prod"));
if (pending)
  await nativeBackup([
    "recover-import",
    "--env",
    "prod",
    pending.backup,
    "--confirm-production",
  ]);
