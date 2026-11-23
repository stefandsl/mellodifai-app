import { StudioShell } from "@/components/studio/studio-shell";
import { requireProfile } from "@/lib/auth";
import { loadPlaylists } from "@/lib/studio/playlists";

export default async function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user, profile } = await requireProfile();
  const [{ data: worker }, playlists] = await Promise.all([
    supabase
      .from("workers")
      .select("id,last_seen,kie_balance,engines")
      .order("last_seen", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadPlaylists(supabase),
  ]);
  return (
    <StudioShell
      email={user.email ?? ""}
      worker={{
        id: worker?.id ?? null,
        lastSeen: worker?.last_seen ?? null,
        balance: worker?.kie_balance ?? null,
        engines: worker?.engines ?? {},
        renderedAt: Date.now(),
      }}
      isAdmin={profile.role === "admin"}
      playlists={playlists}
    >
      {children}
    </StudioShell>
  );
}
