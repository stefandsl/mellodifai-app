import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { redirectUrl } from "@/lib/redirect-url";

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
    return NextResponse.redirect(callback);
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // This applies to password and magic-link sessions alike. A session alone is
  // insufficient: only an allowlisted user receives a profile from the DB trigger.
  if (user && pathname !== "/login" && !pathname.startsWith("/auth/")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile)
      return NextResponse.redirect(
        redirectUrl(request, "/login?message=not-allowed"),
      );
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
