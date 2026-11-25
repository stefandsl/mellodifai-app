import Link from "next/link";
import { StudioPage } from "@/components/studio/studio-shell";
import { callOps } from "@/lib/db/ops-client";
import { sessionCtx } from "@/lib/ops/context";
import type { AgentToken, PairingStatus } from "@/lib/ops/defs/admin-agents";
import { AgentsPanel } from "./agents-panel";

export default async function AgentsPage() {
  const ctx = await sessionCtx().catch(() => null);
  if (!ctx || ctx.remote) return <Refused />;
  // The database checks the current admin role before returning any token details.
  const tokens = await callOps<AgentToken[]>("admin_tokens_list", [ctx]);
  if (!tokens.ok) return <Refused />;
  const [pairing, flags] = await Promise.all([
    callOps<PairingStatus>("admin_pairing_status", [ctx]),
    callOps<Record<string, boolean>>("flags", []),
  ]);
  if (!pairing.ok || !flags.ok) return <Refused />;
  return (
    <StudioPage
      title="Agenti"
      actions={<Link href="/settings">Impostazioni</Link>}
    >
      <AgentsPanel
        tokens={tokens.data}
        pairing={pairing.data}
        remoteMcp={flags.data.remote_mcp === true}
        now={Date.now()}
      />
    </StudioPage>
  );
}

function Refused() {
  return (
    <StudioPage title="Agenti">
      <p role="alert">
        Gestione agenti non disponibile. Accedi come amministratore dal PC
        locale.
      </p>
    </StudioPage>
  );
}
