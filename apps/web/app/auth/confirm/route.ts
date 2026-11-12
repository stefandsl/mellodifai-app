import { type NextRequest, NextResponse } from "next/server";
import { redirectUrl, safeNext } from "@/lib/redirect-url";
import { isRemote } from "@/lib/remote";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  let destination: URL;
  try {
    destination = redirectUrl(
      request,
      safeNext(params.get("next") ?? "", isRemote(request.headers)),
    );
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const invalidLink = new URL("/login?message=invalid-link", destination);
  if (code || (tokenHash && (type === "email" || type === "magiclink"))) {
    try {
      const db = await createClient();
      const { error } = code
        ? await db.auth.exchangeCodeForSession(code)
        : await db.auth.verifyOtp({
            token_hash: tokenHash as string,
            type: type as "email" | "magiclink",
          });
      if (!error) return NextResponse.redirect(destination);
    } catch {
      return NextResponse.redirect(invalidLink);
    }
  }
  return NextResponse.redirect(invalidLink);
}
