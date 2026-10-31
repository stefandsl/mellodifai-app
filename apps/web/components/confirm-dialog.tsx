"use client";
import { t } from "@mellodifai/shared";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ActionCallback } from "@/lib/action-result";
import { useLocale } from "./locale-provider";
import { useAction } from "./use-action";
export function ConfirmDialog({
  trigger,
  title,
  children,
  onConfirm,
  disabled = false,
}: {
  trigger: string;
  title: string;
  children: React.ReactNode;
  onConfirm: ActionCallback;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lang = useLocale();
  const { pending, run } = useAction();
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled || pending}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {t(lang, "action.cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() => run(onConfirm, () => setOpen(false))}
            >
              {t(lang, "action.confirm")}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
