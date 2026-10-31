"use client";
import { t } from "@mellodifai/shared";
import type { ActionResult } from "@/lib/action-result";
import { ConfirmDialog } from "./confirm-dialog";
import { useLocale } from "./locale-provider";
export function PublishConfirmDialog({
  videoName,
  privacy,
  onConfirm,
  disabled = false,
}: {
  videoName: string;
  privacy: "public" | "unlisted" | "scheduled" | "private";
  onConfirm: (
    privacy: "public" | "unlisted" | "scheduled" | "private",
  ) => void | ActionResult | Promise<void> | Promise<ActionResult>;
  disabled?: boolean;
}) {
  const lang = useLocale();
  return (
    <ConfirmDialog
      trigger={t(lang, `privacy.${privacy}`)}
      title={t(lang, "dialog.visibility")}
      onConfirm={() => onConfirm(privacy)}
      disabled={disabled}
    >
      {t(lang, `privacy.${privacy}`)}: <strong>{videoName}</strong>?
    </ConfirmDialog>
  );
}
