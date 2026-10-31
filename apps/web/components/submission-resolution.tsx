"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { useLocale } from "./locale-provider";
import { useAction } from "./use-action";

export function SubmissionResolution({
  kind,
  resolve,
}: {
  kind: "kie" | "upload";
  resolve: (confirmed: boolean, id?: string) => Promise<ActionResult>;
}) {
  const [id, setId] = useState("");
  const { pending, run } = useAction();
  const it = useLocale() === "it";
  const label =
    kind === "kie"
      ? it
        ? "ID attività Kie"
        : "Kie task id"
      : it
        ? "ID video YouTube"
        : "YouTube video id";
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (id.trim()) run(() => resolve(true, id.trim()));
      }}
    >
      <label htmlFor={`${kind}-resolution-id`}>{label}</label>
      <Input
        id={`${kind}-resolution-id`}
        value={id}
        onChange={(event) => setId(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => run(() => resolve(false))}
        >
          {kind === "kie"
            ? it
              ? "Non addebitato"
              : "Not charged"
            : it
              ? "Non caricato"
              : "Not uploaded"}
        </Button>
        <Button type="submit" disabled={pending || !id.trim()}>
          {kind === "kie"
            ? it
              ? "Addebitato, ID attività ..."
              : "Charged, task id ..."
            : it
              ? "Caricato, ID video ..."
              : "Uploaded, video id ..."}
        </Button>
      </div>
    </form>
  );
}
