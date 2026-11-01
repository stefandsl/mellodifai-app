"use client";

import { Eraser } from "lucide-react";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { useCreateForm } from "@/store/create-form";
import { IconButton } from "../ui";

type Field = "lyrics" | "styles" | "title" | "prompt" | "exclude";

const MESSAGES = {
  lyrics: ["create.clearLyrics", "create.clearedLyrics"],
  styles: ["create.clearStyles", "create.clearedStyles"],
  title: ["create.clearTitle", "create.clearedTitle"],
  prompt: ["create.clearPrompt", "create.clearedPrompt"],
  exclude: ["create.clearExclude", "create.clearedExclude"],
} as const;

// Empties one text field and offers to bring the text back for five seconds.
export function ClearButton({
  field,
  className,
}: {
  field: Field;
  className?: string;
}) {
  const lang = useLocale();
  const value = useCreateForm((s) => s[field]);
  const set = useCreateForm((s) => s.set);
  const [label, done] = MESSAGES[field];
  return (
    <IconButton
      label={st(lang, label)}
      disabled={!value}
      className={className ?? "bg-transparent"}
      onClick={() => {
        const previous = value;
        set({ [field]: "" });
        toast(st(lang, done), {
          duration: 5000,
          action: {
            label: st(lang, "create.undo"),
            // Only into a field that is still empty: new text is never overwritten.
            onClick: () => {
              if (!useCreateForm.getState()[field])
                useCreateForm.getState().set({ [field]: previous });
            },
          },
        });
      }}
    >
      <Eraser />
    </IconButton>
  );
}
