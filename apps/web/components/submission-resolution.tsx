"use client";
import { t } from "@mellodifai/shared";
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
  const lang = useLocale();
  const label = t(lang, kind === "kie" ? "resolve.kieId" : "resolve.videoId");
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
          {t(
            lang,
            kind === "kie" ? "resolve.notCharged" : "resolve.notUploaded",
          )}
        </Button>
        <Button type="submit" disabled={pending || !id.trim()}>
          {t(lang, kind === "kie" ? "resolve.charged" : "resolve.uploaded")}
        </Button>
      </div>
    </form>
  );
}
