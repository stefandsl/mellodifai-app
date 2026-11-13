import { OWNER_STACK_PORTS } from "../../../ops/lib/auth-origins";

// The live local stack (supabase_*_mellodifai, API on 44321) and the Windows desktop app's stack
// (mellodifai_desktop, API on 46321) are the owner's: their render PC worker
// claims every queued job and runs the paid engines, so a full-flow test there spends real kie
// credits (it did on 2026-11-01). E2E runs against the separate stack (supabase_*_mellodifai_e2e,
// API on 45621). Only the isolated CI runner may use 54321 with both CI flags.
export const LIVE_STACK_PORTS = OWNER_STACK_PORTS;
const CI_STACK_PORTS = ["54321", "54322"];
export const E2E_STACK_URL = "http://127.0.0.1:45621";

export function localSupabaseUrl(
  value = process.env.SUPABASE_URL,
  env: Record<string, string | undefined> = process.env,
): string {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error("E2E requires a local SUPABASE_URL");
  }
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("E2E requires a local SUPABASE_URL");
  if (
    LIVE_STACK_PORTS.includes(url.port) ||
    (CI_STACK_PORTS.includes(url.port) &&
      !(env.CI === "true" && env.E2E_ALLOW_LIVE_STACK === "1"))
  )
    throw new Error(
      `E2E refuses the live Supabase stack (${url.host}): its worker runs paid engines. Use the e2e stack (${E2E_STACK_URL}); only isolated CI may set CI=true and E2E_ALLOW_LIVE_STACK=1.`,
    );
  return url.href;
}
