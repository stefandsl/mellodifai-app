import { notFound } from "next/navigation";

import { AudioEditor } from "@/components/studio/editor/audio-editor";
import { requireProfile } from "@/lib/auth";
import { loadClips } from "@/lib/studio/clips";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ supabase }, { id }] = await Promise.all([requireProfile(), params]);
  if (!/^[0-9a-f-]{36}$/u.test(id)) notFound();
  const [clip] = await loadClips(supabase, 1, { ids: [id] });
  if (!clip) notFound();
  return <AudioEditor key={`${clip.id}:${clip.chosenTakeId}`} clip={clip} />;
}
