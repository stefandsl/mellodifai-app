"use client";
import { t } from "@mellodifai/shared";
import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionCallback } from "@/lib/action-result";
import { useLocale } from "./locale-provider";
export function useAction() {
  const [pending, startTransition] = useTransition();
  const lang = useLocale();
  function run(action: ActionCallback, success?: () => void) {
    startTransition(async () => {
      try {
        const result = await action();
        if (result && !result.ok) {
          toast.error(result.error);
          return;
        }
        success?.();
      } catch {
        toast.error(t(lang, "error.action"));
      }
    });
  }
  return { pending, run };
}
