import { CreateLayout } from "@/components/studio/create-layout";
import { requireProfile } from "@/lib/auth";
import { loadClips } from "@/lib/studio/clips";

export default async function CreatePage() {
  const { supabase } = await requireProfile();
  return <CreateLayout clips={await loadClips(supabase)} />;
}
