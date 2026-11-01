"use client";
import { t } from "@mellodifai/shared";
import { Button } from "@/components/ui/button";
import type { ActionCallback, ActionResult } from "@/lib/action-result";
import { type LocalCost, localCostSentence } from "@/lib/studio/engines";
import { st } from "@/lib/studio/i18n";
import { ConfirmDialog } from "./confirm-dialog";
import { useLocale } from "./locale-provider";
import { useAction } from "./use-action";
export type Take = {
  id: string;
  audioUrl?: string | null;
  scores?: Record<string, unknown> | null;
};
export function TakePicker({
  takes,
  onPick,
  onGenerateAgain,
  local = null,
}: {
  takes: Take[];
  onPick: (
    id: string,
  ) => void | ActionResult | Promise<void> | Promise<ActionResult>;
  onGenerateAgain: ActionCallback;
  // Set for a song made on the PC: generating again costs no credits.
  local?: LocalCost | null;
}) {
  const lang = useLocale();
  const { pending, run } = useAction();
  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {takes.map((take, index) => (
          <article className="rounded-xl border p-4" key={take.id}>
            <h3>
              {t(lang, "take.label")} {index + 1}
            </h3>
            {take.audioUrl && (
              // biome-ignore lint/a11y/useMediaCaption: music preview; lyrics are reviewed separately.
              <audio controls className="w-full" src={take.audioUrl} />
            )}
            <pre className="overflow-auto text-xs">
              {JSON.stringify(take.scores ?? {}, null, 2)}
            </pre>
            <Button
              disabled={pending}
              onClick={() => run(() => onPick(take.id))}
            >
              {t(lang, "action.pick")}
            </Button>
          </article>
        ))}
      </div>
      <ConfirmDialog
        disabled={pending}
        trigger={
          local
            ? st(lang, "project.generateAgainLocal")
            : t(lang, "action.generateAgain")
        }
        title={t(lang, "dialog.generation")}
        onConfirm={onGenerateAgain}
      >
        {local ? localCostSentence(lang, local) : t(lang, "dialog.cost")}
      </ConfirmDialog>
    </section>
  );
}
