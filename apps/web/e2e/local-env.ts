export function localSupabaseUrl(value = process.env.SUPABASE_URL): string {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error("E2E requires a local SUPABASE_URL");
  }
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("E2E requires a local SUPABASE_URL");
  return url.href;
}
