import { SearchView } from "@/components/studio/search/search-view";
import { requireProfile } from "@/lib/auth";
import { loadClips } from "@/lib/studio/clips";

export default async function SearchPage() {
  const { supabase } = await requireProfile();
  return <SearchView clips={await loadClips(supabase, 500)} />;
}
