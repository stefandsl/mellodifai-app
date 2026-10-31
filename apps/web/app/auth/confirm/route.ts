import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    try {
      const db = await createClient();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error)
        return NextResponse.redirect(new URL("/library", request.url));
    } catch {
      return NextResponse.redirect(
        new URL("/login?message=invalid-link", request.url),
      );
    }
  }
  return NextResponse.redirect(
    new URL("/login?message=invalid-link", request.url),
  );
}
