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
  const trash = tab === "trash";
  return (
    <div className="mx-auto h-full max-w-6xl">
      <WorkspaceFeed
        key={trash ? "trash" : videos ? "videos" : "all"}
        clips={await loadClips(supabase, 500, { trash })}
        initialFilters={videos ? ["video"] : []}
        heading={st(
          lang,
          trash ? "nav.trash" : videos ? "nav.videos" : "nav.library",
        )}
        trash={trash}
        trashLink
      />
    </div>
  );
}
