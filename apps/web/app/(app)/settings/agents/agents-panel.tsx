"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import type { ActionResult } from "@/lib/action-result";
import type { AgentToken, PairingStatus } from "@/lib/ops/defs/admin-agents";
import { createToken, openPairing, revokeToken, setRemoteMcp } from "./actions";

function DateTime({ value }: { value: string | null }) {
  return value ? (
    <time dateTime={value}>
      {new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome" })}
    </time>
  ) : (
    <>Mai</>
  );
}

export function AgentsPanel({
  tokens,
  pairing,
  remoteMcp,
  now,
}: {
  tokens: AgentToken[];
  pairing: PairingStatus;
  remoteMcp: boolean;
  now: number;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [token, setToken] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  const [clock, setClock] = useState(now);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState(() =>
    new Date(now + 90 * 86400000).toISOString().slice(0, 16),
  );
  const until = pairing.open_until ? Date.parse(pairing.open_until) : 0;
  const remaining = pairing.client_name
    ? 0
    : Math.max(0, Math.ceil((until - Math.max(clock, now)) / 1000));

  useEffect(() => {
    if (!until || pairing.client_name) return;
    let ticks = 0;
    const timer = setInterval(() => {
      setClock(Date.now());
      if (++ticks % 5 === 0 || Date.now() >= until) router.refresh();
      if (Date.now() >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until, pairing.client_name, router]);

  async function refresh(action: () => Promise<ActionResult>) {
    const result = await action();
    if (result.ok) router.refresh();
    return result;
  }

  return (
    <div className="space-y-6">
      <section
        className="space-y-4 rounded-2xl bg-[var(--surface-1)] p-6"
        aria-label="Accesso remoto"
      >
        <Label className="flex items-center gap-3">
          <Checkbox
            role="switch"
            checked={remoteMcp}
            disabled={pending}
            onCheckedChange={(enabled) =>
              run(() => refresh(() => setRemoteMcp(enabled)))
            }
          />
          MCP remoto
        </Label>
        <p className="text-sm text-muted-foreground">
          Disattivando MCP remoto blocchi subito OAuth e i token usati da
          remoto.
        </p>
        <Button
          disabled={pending || remaining > 0}
          onClick={() => run(() => refresh(openPairing))}
        >
          Collega un agente
        </Button>
        <p role="timer">
          {remaining > 0
            ? `Tempo rimanente: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
            : "Finestra di collegamento chiusa"}
        </p>
        {pairing.client_name && (
          <div className="space-y-1 break-words text-sm">
            <p>
              Client collegato: <strong>{pairing.client_name}</strong>
            </p>
            <p>
              Destinazione: <span>{pairing.redirect_host}</span>
            </p>
            <p>
              Registrato il: <DateTime value={pairing.registered_at} />
            </p>
            <p>Verifica che sia il client che volevi collegare.</p>
          </div>
        )}
      </section>
      <form
        className="space-y-4 rounded-2xl bg-[var(--surface-1)] p-6"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          run(async () => {
            setToken(null);
            setError(null);
            const result = await createToken({
              name: String(values.get("name") ?? ""),
              scopes: values.getAll("scope") as Array<
                "read" | "create" | "spend"
              >,
              remote,
              testMode: values.has("test"),
              expiresAt:
                remote && expiry ? new Date(`${expiry}Z`).toISOString() : null,
            });
            if (result.ok) {
              if (result.token) setToken(result.token);
              else
                setError(
                  "Token creato ma non disponibile. Revocalo prima di crearne un altro.",
                );
              router.refresh();
            } else setError(result.error);
            return result;
          });
        }}
      >
        <h2 className="text-xl font-medium">Nuovo token</h2>
        <Label className="block space-y-2">
          Nome
          <Input name="name" required maxLength={60} autoComplete="off" />
        </Label>
        <fieldset className="flex flex-wrap gap-4" disabled={pending}>
          <legend className="mb-2">Permessi</legend>
          {[
            ["read", "Leggere"],
            ["create", "Creare"],
            ["spend", "Spendere"],
          ].map(([value, label]) => (
            <Label className="flex items-center gap-2" key={value}>
              <Checkbox
                name="scope"
                value={value}
                defaultChecked={value === "read"}
              />
              {label}
            </Label>
          ))}
        </fieldset>
        <Label className="flex items-center gap-2">
          <Checkbox checked={remote} onCheckedChange={setRemote} />
          Uso remoto
        </Label>
        {remote && (
          <Label className="block space-y-2">
            Scadenza (UTC)
            <Input
              type="datetime-local"
              required
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </Label>
        )}
        <Label className="flex items-center gap-2">
          <Checkbox name="test" />
          Test (provider simulati)
        </Label>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={pending || token !== null}>
          Nuovo token
        </Button>
      </form>
      <section
        className="overflow-x-auto rounded-2xl bg-[var(--surface-1)] p-6"
        aria-label="Token degli agenti"
      >
        <table className="w-full text-left text-sm">
          <caption className="mb-4 text-left text-xl font-medium">
            Token degli agenti
          </caption>
          <thead>
            <tr>
              {[
                "Nome",
                "Tipo",
                "Indizio",
                "Permessi",
                "Remoto",
                "Test",
                "Scadenza",
                "Ultimo utilizzo",
                "Revocato",
                "Azioni",
              ].map((label) => (
                <th key={label} scope="col" className="p-2">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.map((item) => (
              <tr key={item.id} className="border-t border-[var(--hairline)]">
                <td className="p-2">{item.name}</td>
                <td className="p-2">{item.kind}</td>
                <td className="p-2">{item.token_hint ?? "Non disponibile"}</td>
                <td className="p-2">{item.scopes.join(", ")}</td>
                <td className="p-2">{item.remote ? "Sì" : "No"}</td>
                <td className="p-2">{item.test_mode ? "Sì" : "No"}</td>
                <td className="p-2">
                  {item.expires_at ? (
                    <DateTime value={item.expires_at} />
                  ) : (
                    "Nessuna"
                  )}
                </td>
                <td className="p-2">
                  <DateTime value={item.last_used_at} />
                </td>
                <td className="p-2">
                  {item.revoked_at ? (
                    <DateTime value={item.revoked_at} />
                  ) : (
                    "No"
                  )}
                </td>
                <td className="p-2">
                  <ConfirmDialog
                    trigger="Revoca"
                    title="Revocare il token?"
                    disabled={!!item.revoked_at || pending}
                    onConfirm={() => refresh(() => revokeToken(item.id))}
                  >
                    Il token di {item.name} smetterà subito di funzionare.
                  </ConfirmDialog>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tokens.length === 0 && <p>Nessun token creato.</p>}
      </section>
      <Dialog
        open={token !== null}
        onOpenChange={(open) => {
          if (!open) setToken(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogTitle>Salva il token</DialogTitle>
          <DialogDescription>
            Il token viene mostrato una sola volta. Copialo e conservalo in un
            luogo sicuro.
          </DialogDescription>
          <code className="break-all select-all">{token}</code>
          <Button onClick={() => setToken(null)}>Ho salvato il token</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
