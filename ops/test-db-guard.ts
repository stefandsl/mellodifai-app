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
      !protocols.includes(url.protocol)
    )
      throw new Error(`${name} must be a loopback test-stack URL`);
    if (["54321", "54322"].includes(url.port) && env.CI !== "true")
      throw new Error(`${name} refuses the production port block outside CI`);
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
