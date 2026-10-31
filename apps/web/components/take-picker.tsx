"use client";

import { t } from "@mellodifai/shared";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./confirm-dialog";

export type Take = {
  id: string;
  audioUrl?: string | null;
  scores?: Record<string, unknown> | null;
};

export function TakePicker({
  takes,
  onPick,
  onGenerateAgain,
}: {
  takes: Take[];
  onPick: (id: string) => void | Promise<void>;
  onGenerateAgain: () => void | Promise<void>;
}) {
  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {takes.map((take, index) => (
          <article className="rounded-xl border p-4" key={take.id}>
            <h3 className="font-medium">Take {index + 1}</h3>
            {take.audioUrl && (
              // biome-ignore lint/a11y/useMediaCaption: generated music previews have no captions.
              <audio controls className="mt-3 w-full" src={take.audioUrl} />
            )}
            <pre className="mt-3 overflow-auto text-xs text-muted-foreground">
              {JSON.stringify(take.scores ?? {}, null, 2)}
            </pre>
            <Button className="mt-3" onClick={() => onPick(take.id)}>
              {t("it", "action.pick")}
            </Button>
          </article>
        ))}
      </div>
      <ConfirmDialog
        trigger={t("it", "action.generateAgain")}
        title="Confirm new generation"
        onConfirm={onGenerateAgain}
      >
        This will spend 12 kie credits for this language.
      </ConfirmDialog>
    </section>
  );
}
