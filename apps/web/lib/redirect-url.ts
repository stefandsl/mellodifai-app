export function redirectUrl(request: Request, path: string): URL {
  const first = (name: string) =>
    request.headers.get(name)?.split(",")[0]?.trim();
  const host = first("x-forwarded-host") || first("host");
  if (!host) throw new Error("Redirect requires a request Host header");
  const protocol =
    first("x-forwarded-proto") || new URL(request.url).protocol.slice(0, -1);
  return new URL(path, `${protocol}://${host}`);
}
