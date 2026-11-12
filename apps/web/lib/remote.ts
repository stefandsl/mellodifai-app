export function isRemote(headers: Headers): boolean {
  return (
    headers.get("x-mdf-remote") === "1" ||
    headers.has("cf-connecting-ip") ||
    headers.has("cf-ray")
  );
}
