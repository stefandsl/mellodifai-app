export function redirectUrl(
  request: Request & { nextUrl?: { origin: string } },
  path: string,
): URL {
  const parse = (value: string | undefined) => {
    try {
      const url = new URL(value ?? "");
      return ["http:", "https:"].includes(url.protocol) ? url : undefined;
    } catch {
      return undefined;
    }
  };
  const site = parse(process.env.NEXT_PUBLIC_SITE_URL);
  const fallback =
    site?.origin ?? request.nextUrl?.origin ?? new URL(request.url).origin;
  const first = (name: string) =>
    request.headers.get(name)?.split(",")[0]?.trim();
  const host = first("x-forwarded-host") || first("host");
  const protocol =
    first("x-forwarded-proto") || new URL(request.url).protocol.slice(0, -1);
  const candidate = parse(`${protocol}://${host}`);
  const valid =
    host &&
    candidate &&
    ["http", "https"].includes(protocol) &&
    (candidate.host === host.toLowerCase() ||
      `${candidate.host}:${protocol === "http" ? "80" : "443"}` ===
        host.toLowerCase()) &&
    !candidate.username &&
    !candidate.password &&
    candidate.pathname === "/" &&
    !candidate.search &&
    !candidate.hash &&
    (candidate.host === site?.host ||
      (process.env.NODE_ENV === "development" &&
        ["127.0.0.1", "localhost"].includes(candidate.hostname)));
  return new URL(path, valid ? candidate.origin : fallback);
}
