import { WorkspaceFeed } from "@/components/studio/feed/workspace-feed";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { loadClips } from "@/lib/studio/clips";
import { st } from "@/lib/studio/i18n";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ supabase }, { tab }, lang] = await Promise.all([
    requireProfile(),
    searchParams,
    getLocale(),
  ]);
  const videos = tab === "videos";
  return (
    <div className="mx-auto h-full max-w-6xl">
      <WorkspaceFeed
        key={videos ? "videos" : "all"}
        clips={await loadClips(supabase, 500)}
        initialFilters={videos ? ["video"] : []}
        heading={st(lang, videos ? "nav.videos" : "nav.library")}
      />
    </div>
  );
}
