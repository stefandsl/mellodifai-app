import { AUTH_ORIGINS } from "../../../ops/lib/auth-origins";
import { isRemote } from "./remote";

type RedirectEnv = { siteUrl: string; redirectUrls: string[] };

export function signInEnvironment(): RedirectEnv {
  const siteUrl =
    process.env.SITE_URL ||
    (process.env.NODE_ENV === "development"
      ? AUTH_ORIGINS.dev.siteUrl
      : AUTH_ORIGINS.prod.siteUrl);
  const values = Object.values(AUTH_ORIGINS).find(
    (env) => env.siteUrl === siteUrl,
  );
  if (!values)
    throw new Error("SITE_URL must select a configured stack origin");
  return {
    siteUrl,
    redirectUrls: [
      ...values.redirectUrls,
      // The accepted progress ruling reserves 3210 for the owner's launcher.
      ...(siteUrl === AUTH_ORIGINS.e2e.siteUrl &&
      process.env.SUPABASE_INTERNAL_URL === "http://127.0.0.1:45621" &&
      process.env.E2E_PORT === "3219"
        ? ["http://127.0.0.1:3219/**"]
        : []),
    ],
  };
}

export function safeNext(next: string, remote: boolean): string {
  const fallback = remote ? "/login" : "/create";
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  try {
    const decoded = decodeURIComponent(next);
    if (
      decoded.startsWith("//") ||
      [...decoded].some(
        (char) =>
          char === "\\" ||
          char.charCodeAt(0) < 32 ||
          char.charCodeAt(0) === 127,
      )
    )
      return fallback;
    const url = new URL(next, "http://app.local");
    if (
      url.origin !== "http://app.local" ||
      url.pathname !== next.split(/[?#]/u)[0]
    )
      return fallback;
    if (
      remote &&
      (url.pathname !== "/consent" ||
        !url.searchParams.get("uid")?.trim() ||
        [...url.searchParams.keys()].length !== 1 ||
        url.hash)
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

function allowedOrigin(
  origin: string,
  env: RedirectEnv,
  remote: boolean,
): string {
  if (remote) return new URL(env.siteUrl).origin;
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !env.redirectUrls.some((pattern) => pattern === `${url.origin}/**`)
  ) {
    throw new Error("Origin is outside additional_redirect_urls");
  }
  return url.origin;
}

export function emailRedirect(
  origin: string,
  env: RedirectEnv,
  remote: boolean,
  next: string,
): string {
  const callback = new URL("/auth/confirm", allowedOrigin(origin, env, remote));
  callback.searchParams.set("next", safeNext(next, remote));
  return callback.href;
}

export function requestOrigin(headers: Headers, fallback: string): string {
  const first = (name: string) => headers.get(name)?.split(",")[0]?.trim();
  const host = first("x-forwarded-host") || first("host");
  const protocol =
    first("x-forwarded-proto") || new URL(fallback).protocol.slice(0, -1);
  return host ? `${protocol}://${host}` : new URL(fallback).origin;
}

export function redirectUrl(request: Request, path: string): URL {
  return new URL(
    path,
    allowedOrigin(
      requestOrigin(request.headers, request.url),
      signInEnvironment(),
      isRemote(request.headers),
    ),
  );
}
