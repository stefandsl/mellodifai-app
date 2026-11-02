import { type NextRequest, NextResponse } from "next/server";
import { redirectUrl } from "@/lib/redirect-url";
import { createClient } from "@/lib/supabase/server";

function destination(request: NextRequest): string {
  const origin = redirectUrl(request, "/");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  const fallback = local ? "/create" : "/login";
  const next = request.nextUrl.searchParams.get("next");
  if (!next?.startsWith("/") || next.startsWith("//")) return fallback;
  try {
    if (
      [...decodeURIComponent(next)].some(
        (char) => char === "\\" || char.charCodeAt(0) <= 32,
      )
    )
      return fallback;
    const url = new URL(next, origin);
    if (url.origin !== origin.origin) return fallback;
    if (
      !local &&
      (url.pathname !== "/consent" ||
        !url.searchParams.get("uid") ||
        [...url.searchParams.keys()].some((key) => key !== "uid") ||
        url.hash)
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (code || (tokenHash && (type === "email" || type === "magiclink"))) {
    try {
      const db = await createClient();
      const { error } = code
        ? await db.auth.exchangeCodeForSession(code)
        : await db.auth.verifyOtp({
            token_hash: tokenHash as string,
            type: type as "email" | "magiclink",
          });
      if (!error)
        return NextResponse.redirect(
          redirectUrl(request, destination(request)),
        );
    } catch {
      return NextResponse.redirect(
        redirectUrl(request, "/login?message=invalid-link"),
      );
    }
  }
  return NextResponse.redirect(
    redirectUrl(request, "/login?message=invalid-link"),
  );
}
