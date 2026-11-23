import { redirect } from "next/navigation";
import { callOps } from "@/lib/db/ops-client";
import { sessionCtx } from "@/lib/ops/context";
import {
  type ConsentInfo,
  consentUid,
  flowNonce,
} from "@/lib/ops/defs/oauth-consent";
import { ConsentForm } from "./consent-form";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ uid?: string | string[] }>;
}) {
  const uid = consentUid.safeParse((await searchParams).uid);
  if (!uid.success) return <Restart />;
  const ctx = await sessionCtx().catch(() =>
    redirect(
      `/login?next=${encodeURIComponent(`/consent?uid=${encodeURIComponent(uid.data)}`)}`,
    ),
  );
  const nonce = await flowNonce();
  if (!nonce) return <Restart />;
  const result = await callOps<ConsentInfo>("oauth_consent_info", [
    ctx,
    uid.data,
    nonce,
  ]);
  if (!result.ok) return <Restart />;
  // oauth_consent_info authorizes admins before returning any client details.
  const info = result.data;
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg)] p-5">
      <section className="w-full max-w-md space-y-5 rounded-3xl bg-[var(--surface-1)] p-7 ring-1 ring-[var(--hairline)]">
        <h1 className="text-2xl font-medium">Collega un agente</h1>
        <dl className="space-y-2 break-words text-sm">
          <dt className="text-muted-foreground">Client</dt>
          <dd className="font-medium">{info.client_name}</dd>
          <dt className="text-muted-foreground">Destinazione</dt>
          <dd>{info.redirect_host}</dd>
          <dt className="text-muted-foreground">Registrato il</dt>
          <dd>
            <time dateTime={info.registered_at}>
              {new Date(info.registered_at).toLocaleString("it-IT", {
                timeZone: "Europe/Rome",
              })}
            </time>
          </dd>
        </dl>
        <ConsentForm uid={uid.data} info={info} />
      </section>
    </main>
  );
}

function Restart() {
  return (
    <main className="grid min-h-dvh place-items-center p-5">
      <p role="alert">
        Avvia di nuovo il collegamento dal tuo agente in questo browser.
      </p>
    </main>
  );
}
