import { StudioPage } from "@/components/studio/studio-shell";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { st } from "@/lib/studio/i18n";
import { workerIsOnline } from "@/lib/worker";

const SONG_COST = 12;

export default async function CreditsPage() {
  const [{ supabase, profile }, lang] = await Promise.all([
    requireProfile(),
    getLocale(),
  ]);
  const { data: worker } = await supabase
    .from("workers")
    .select("id,last_seen,kie_balance")
    .order("last_seen", { ascending: false })
    .limit(1)
    .maybeSingle();
  const balance = worker?.kie_balance ?? null;
  const online = workerIsOnline(worker?.last_seen ?? null);
  const locale = lang === "it" ? "it-IT" : "en-US";
  return (
    <StudioPage title={st(lang, "credits.title")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-2xl bg-[var(--surface-1)] p-6">
          <h2 className="text-[13px] text-[var(--fg-muted)]">
            {st(lang, "credits.kie")}
          </h2>
          <p className="mt-2 text-5xl font-medium tabular-nums tracking-tight">
            {balance ?? "-"}
          </p>
          <p className="mt-3 text-[var(--fg-muted)]">
            <span className="font-medium text-[var(--fg)] tabular-nums">
              {balance === null ? "-" : Math.floor(balance / SONG_COST)}
            </span>{" "}
            {st(lang, "credits.songs")}
          </p>
          {profile.role === "admin" ? (
            <p className="mt-3 text-[13px] text-balance text-[var(--fg-muted)]">
              {st(lang, "credits.local")}
            </p>
          ) : null}
        </section>
        <section className="rounded-2xl bg-[var(--surface-1)] p-6">
          <h2 className="text-[13px] text-[var(--fg-muted)]">
            {st(lang, "credits.worker")}
          </h2>
          <p className="mt-3 flex items-center gap-2.5 text-xl font-medium">
            <span
              className={`size-2.5 rounded-full ${online ? "bg-[var(--success)]" : "bg-[var(--fg-subtle)]"}`}
            />
            {st(lang, online ? "worker.online" : "worker.offline")}
          </p>
          <p className="mt-3 text-[var(--fg-muted)]">
            {st(lang, "credits.lastSeen")}:{" "}
            <span className="text-[var(--fg)]">
              {worker?.last_seen
                ? new Date(worker.last_seen).toLocaleString(locale)
                : st(lang, "credits.never")}
            </span>
          </p>
        </section>
      </div>
    </StudioPage>
  );
}
