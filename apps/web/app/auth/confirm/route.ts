import { type NextRequest, NextResponse } from "next/server";
import { redirectUrl } from "@/lib/redirect-url";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    try {
      const db = await createClient();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(redirectUrl(request, "/create"));
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
