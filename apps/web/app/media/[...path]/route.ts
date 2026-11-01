import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Redirects to a freshly signed link for a stored file. Signing runs as the signed-in user, so
// the storage policies decide who may read it. `download` names the file as an attachment.
// Song files live in the previews bucket (their paths start with previews/ or edits/); the Video
// Studio's uploads and stock backgrounds in the uploads bucket, linked as /media/uploads/<path>.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const download = request.nextUrl.searchParams.get("download");
  const db = await createClient();
  const uploads = path[0] === "uploads" && path.length > 1;
  const { data } = await db.storage
    .from(uploads ? "uploads" : "previews")
    .createSignedUrl(
      (uploads ? path.slice(1) : path).join("/"),
      3600,
      download ? { download } : undefined,
    );
  if (!data?.signedUrl) return new NextResponse(null, { status: 404 });
  // The browser may reuse the redirect well within the link's hour.
  return NextResponse.redirect(data.signedUrl, {
    status: 307,
    headers: { "Cache-Control": "private, max-age=600" },
  });
}
