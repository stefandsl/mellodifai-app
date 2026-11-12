import { headers } from "next/headers";
import { SettingsPanel } from "@/components/studio/settings-panel";
import { StudioPage } from "@/components/studio/studio-shell";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { isRemote } from "@/lib/remote";
import { st } from "@/lib/studio/i18n";

export default async function SettingsPage() {
  const [{ user, profile }, lang, requestHeaders] = await Promise.all([
    requireProfile(),
    getLocale(),
    headers(),
  ]);
  return (
    <StudioPage title={st(lang, "settings.title")}>
      <SettingsPanel
        email={user.email ?? ""}
        canManageAgents={profile.role === "admin" && !isRemote(requestHeaders)}
      />
    </StudioPage>
  );
}
