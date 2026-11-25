import { notFound } from "next/navigation";

import { AudioEditor } from "@/components/studio/editor/audio-editor";
import { requireProfile } from "@/lib/auth";
import { loadClips } from "@/lib/studio/clips";
import { loadRewrite } from "@/lib/studio/rewrite";

// The audio editor of a song: "Taglia e dissolvi" (T11), or "Riscrivi una parte" with
// ?tab=rewrite (T12).
export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ supabase }, { id }, query] = await Promise.all([
    requireProfile(),
    params,
    searchParams,
  ]);
  if (!/^[0-9a-f-]{36}$/u.test(id)) notFound();
  const [clip] = await loadClips(supabase, 1, { ids: [id] });
  if (!clip) notFound();
  const tab = query.tab === "rewrite" ? "rewrite" : "trim";
  const rewrite =
    tab === "rewrite" ? await loadRewrite(supabase, clip) : undefined;
  return (
    <AudioEditor
      key={`${clip.id}:${clip.chosenTakeId}:${clip.takes.length}:${tab}`}
      clip={clip}
      tab={tab}
      rewrite={rewrite}
    />
  );
}
