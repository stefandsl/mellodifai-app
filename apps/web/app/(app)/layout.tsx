import { StudioShell } from "@/components/studio/studio-shell";
import { requireProfile } from "@/lib/auth";

export default async function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user } = await requireProfile();
  const { data: worker } = await supabase
    .from("workers")
    .select("id,last_seen,kie_balance")
    .order("last_seen", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    <StudioShell
      email={user.email ?? ""}
      worker={{
        id: worker?.id ?? null,
        lastSeen: worker?.last_seen ?? null,
        balance: worker?.kie_balance ?? null,
      }}
    >
      {children}
    </StudioShell>
  );
}
