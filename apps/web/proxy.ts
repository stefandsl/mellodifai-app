import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { redirectUrl, safeNext } from "@/lib/redirect-url";
import { isRemote } from "@/lib/remote";

export async function proxy(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const pathname = request.nextUrl.pathname;
  if (
    code &&
    request.method === "GET" &&
    pathname !== "/auth/confirm" &&
    !/^\/(api|_next)(\/|$)/u.test(pathname)
  ) {
    // Recover codes sent to Site URL when the auth redirect allowlist is incomplete.
    const callback = redirectUrl(request, "/auth/confirm");
    callback.searchParams.set("code", code);
    const next = request.nextUrl.searchParams.get("next");
    if (next)
      callback.searchParams.set(
        "next",
        safeNext(next, isRemote(request.headers)),
      );
    return NextResponse.redirect(callback);
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.SUPABASE_INTERNAL_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (entries) => {
          entries.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          entries.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/((?!api/(?:v1|mcp|health|transcribe)(?:/|$)|\\.well-known(?:/|$)|_next/static|_next/image|favicon.ico).*)",
  ],
};
