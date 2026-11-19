import Link from "next/link";
import { pt } from "@/components/studio/publishing/copy";
import { PublishSettings } from "@/components/studio/publishing/publish-settings";
import { StudioPage } from "@/components/studio/studio-shell";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { sessionCtx } from "@/lib/ops/context";
import { publishRulesList } from "@/lib/ops/defs/publishing";
import { runOp } from "@/lib/ops/run";

// Settings > Pubblicazione: standing rules and waiting approval cards. The database refuses
// anything but the owner's local admin session.
export default async function PublishingSettingsPage() {
  const [{ profile }, lang] = await Promise.all([
    requireProfile(),
    getLocale(),
  ]);
  const ctx = await sessionCtx().catch(() => null);
  const result =
    ctx && !ctx.remote && profile.role === "admin"
      ? await runOp(publishRulesList, ctx, {})
      : null;
  const back = (
    <Link
      href="/settings"
      className="text-sm underline-offset-4 hover:underline"
    >
      {pt(lang, "backSettings")}
    </Link>
  );
  if (!result?.ok || "committed" in result)
    return (
      <StudioPage title={pt(lang, "settings")} actions={back}>
        <p className="text-muted-foreground">{pt(lang, "notAdmin")}</p>
      </StudioPage>
    );
  return (
    <StudioPage title={pt(lang, "settings")} actions={back}>
      <PublishSettings
        rules={result.data.rules}
        approvals={result.data.approvals}
      />
    </StudioPage>
  );
}
