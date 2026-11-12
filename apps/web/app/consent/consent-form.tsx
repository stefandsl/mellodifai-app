"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConsentInfo } from "@/lib/ops/defs/oauth-consent";
import { consentDecide } from "./actions";

const permissions = {
  read: "Leggere",
  create: "Creare",
  spend: "Spendere",
} as const;
type Scope = keyof typeof permissions;

export function ConsentForm({ uid, info }: { uid: string; info: ConsentInfo }) {
  const id = useId();
  const [scopes, setScopes] = useState<Scope[]>(
    info.requested_scopes.includes("read") ? ["read"] : [],
  );
  const [confirmName, setConfirmName] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const spend = scopes.includes("spend");
  return (
    <form
      className="space-y-5"
      action={() =>
        startTransition(async () => {
          setError("");
          try {
            const result = await consentDecide(
              uid,
              scopes,
              testMode,
              confirmName,
            );
            if (!result.ok) {
              setError(result.error);
              return;
            }
            // Auth owns this route, so use a full navigation rather than a Next RSC request.
            window.location.assign(
              `/oauth/interaction/${encodeURIComponent(uid)}/resume`,
            );
          } catch {
            setError(
              "Impossibile completare il collegamento. Avvialo di nuovo dal tuo agente in questo browser.",
            );
          }
        })
      }
    >
      <fieldset disabled={pending} className="space-y-3">
        <legend className="mb-3 font-medium">Permessi da concedere</legend>
        {(Object.keys(permissions) as Scope[]).map((scope) => (
          <Label
            key={scope}
            id={`${id}-${scope}-label`}
            htmlFor={`${id}-${scope}`}
            className="flex items-center gap-3"
          >
            <Checkbox
              id={`${id}-${scope}`}
              aria-labelledby={`${id}-${scope}-label`}
              name="scopes"
              value={scope}
              checked={scopes.includes(scope)}
              disabled={!info.requested_scopes.includes(scope)}
              onCheckedChange={(checked) =>
                setScopes((current) =>
                  checked
                    ? [...current, scope]
                    : current.filter((value) => value !== scope),
                )
              }
            />
            {permissions[scope]}
          </Label>
        ))}
        {spend && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              La spesa usa crediti a pagamento. Per confermare, digita
              esattamente il nome del client mostrato sopra.
            </p>
            <Label htmlFor="confirm-name">
              Nome del client per confermare la spesa
            </Label>
            <Input
              id="confirm-name"
              autoComplete="off"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              required
            />
          </div>
        )}
        <Label
          id={`${id}-test-label`}
          htmlFor={`${id}-test`}
          className="flex items-center gap-3"
        >
          <Checkbox
            id={`${id}-test`}
            aria-labelledby={`${id}-test-label`}
            name="test-mode"
            checked={testMode}
            onCheckedChange={setTestMode}
          />
          Test (provider simulati)
        </Label>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={
          pending ||
          scopes.length === 0 ||
          (spend && confirmName !== info.client_name)
        }
      >
        Autorizza
      </Button>
      <p className="text-sm text-muted-foreground">
        Se non vuoi autorizzare questo agente, chiudi questa pagina.
      </p>
    </form>
  );
}
