import { notFound } from "next/navigation";

import { PlaylistView } from "@/components/studio/playlists/playlist-view";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { st } from "@/lib/studio/i18n";
import { loadPlaylistPage } from "@/lib/studio/playlists";

export default async function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ supabase }, { id }, lang] = await Promise.all([
    requireProfile(),
    params,
    getLocale(),
  ]);
  const page = await loadPlaylistPage(supabase, id, st(lang, "pl.liked"));
  if (!page) notFound();
  return (
    <PlaylistView
      key={page.playlist.id}
      playlist={page.playlist}
      clips={page.clips}
      system={page.system}
    />
  );
}
