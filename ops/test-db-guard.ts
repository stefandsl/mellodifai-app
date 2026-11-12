import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function assertTestStack(env: Record<string, string | undefined>): void {
  for (const name of ["TEST_DB_URL", "SUPABASE_URL"]) {
    let url: URL;
    try {
      url = new URL(env[name] ?? "");
    } catch {
      throw new Error(`${name} must be a loopback test-stack URL`);
    }
    const protocols =
      name === "TEST_DB_URL"
        ? ["postgres:", "postgresql:"]
        : ["http:", "https:"];
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !protocols.includes(url.protocol) ||
      (name === "TEST_DB_URL" && (url.search !== "" || url.hash !== ""))
    )
      throw new Error(`${name} must be a loopback test-stack URL`);
    if (["44321", "44322", "55321", "55322"].includes(url.port))
      throw new Error(`${name} refuses a non-test stack`);
    if (["54321", "54322"].includes(url.port) && env.CI !== "true")
      throw new Error(`${name} refuses the production port block outside CI`);
  }
}

export function assertTestWebStack(
  env: Record<string, string | undefined>,
): void {
  assertTestStack(env);
  assertTestStack({ ...env, TEST_DB_URL: env.MDF_WEB_DATABASE_URL });
  const db = new URL(env.TEST_DB_URL as string);
  const web = new URL(env.MDF_WEB_DATABASE_URL as string);
  const api = new URL(env.SUPABASE_URL as string);
  if (
    // postgres accepts query parameters that override the apparent URL target.
    web.search ||
    db.search ||
    web.hash ||
    db.hash ||
    web.hostname !== db.hostname ||
    web.port !== db.port ||
    web.pathname !== db.pathname ||
    api.hostname !== db.hostname ||
    Number(api.port) + 1 !== Number(db.port)
  ) {
    throw new Error(
      "MDF_WEB_DATABASE_URL must target the same isolated test stack",
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assertTestStack(process.env);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
