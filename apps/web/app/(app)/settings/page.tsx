import { backupAvailable } from "@/app/actions/backup";
import { SettingsPanel } from "@/components/studio/settings-panel";
import { StudioPage } from "@/components/studio/studio-shell";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { st } from "@/lib/studio/i18n";

export default async function SettingsPage() {
  const [{ user, profile }, lang] = await Promise.all([
    requireProfile(),
    getLocale(),
  ]);
  return (
    <StudioPage title={st(lang, "settings.title")}>
      <SettingsPanel
        email={user.email ?? ""}
        canBackup={profile.role === "admin" && (await backupAvailable())}
      />
    </StudioPage>
  );
}
