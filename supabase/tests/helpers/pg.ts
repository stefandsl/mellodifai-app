import { ownerConnection } from "../../../ops/lib/pg";
import { assertTestStack } from "../../../ops/test-db-guard";

export function ownerSql(url = process.env.TEST_DB_URL) {
  assertTestStack({ ...process.env, TEST_DB_URL: url });
  if (!url) throw new Error("TEST_DB_URL is required");
  return ownerConnection(url);
}
