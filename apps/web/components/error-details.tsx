"use client";
import { t } from "@mellodifai/shared";
import { useLocale } from "./locale-provider";

// Short worker errors are actionable (kie recovery, quota) and stay visible;
// long technical dumps are folded away.
const SHORT_ERROR = 160;

export function ErrorDetails({ text }: { text: string }) {
  const lang = useLocale();
  if (text.length <= SHORT_ERROR)
    return (
      <p role="alert" className="text-sm">
        {text}
      </p>
    );
  return (
    <details role="alert" className="mt-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        {t(lang, "error.details")}
      </summary>
      <p className="mt-1 break-words font-mono">{text}</p>
    </details>
  );
}
