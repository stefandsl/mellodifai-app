import { notFound } from "next/navigation";

import { StemsView } from "@/components/studio/stems/stems-view";
import { requireProfile } from "@/lib/auth";
import { loadStemsPage } from "@/lib/studio/stems";

export default async function StemsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ supabase }, { id }] = await Promise.all([requireProfile(), params]);
  // Only ids can name a song; anything else is not one of the caller's.
  if (!/^[0-9a-f-]{36}$/u.test(id)) notFound();
  const page = await loadStemsPage(supabase, id);
  if (!page) notFound();
  return <StemsView key={page.clip.id} page={page} />;
}
