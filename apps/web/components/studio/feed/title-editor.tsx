"use client";

import { cn } from "cn";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { renameVersion } from "@/app/actions/library";
import { useLocale } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import { st } from "@/lib/studio/i18n";

// The song title on a card. A pencil (shown on hover, always on touch screens) turns it into
// an input: Enter saves, Escape or leaving the field cancels.
export function TitleEditor({
  clip,
  title,
  className,
  editable = true,
}: {
  clip: Clip;
  title: string;
  className?: string;
  editable?: boolean;
}) {
  const lang = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  // Shows the saved title until the refreshed page data carries it.
  const [saved, setSaved] = useState<{ from: string; to: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = saved && saved.from === title ? saved.to : title;

  const cancel = () => {
    if (!busy) setEditing(false);
  };
  const save = async () => {
    const next = value.trim();
    if (!next || next === shown) return setEditing(false);
    setBusy(true);
    let ok = false;
    try {
      ok = (await renameVersion({ versionId: clip.id, title: next })).ok;
    } catch {}
    setBusy(false);
    if (!ok) {
      toast.error(st(lang, "clip.renameFailed"));
      return input.current?.focus();
    }
    setSaved({ from: title, to: next });
    setEditing(false);
    router.refresh();
  };

  if (editing)
    return (
      <input
        ref={input}
        // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked to rename.
        autoFocus
        value={value}
        maxLength={100}
        disabled={busy}
        aria-label={st(lang, "clip.renameLabel")}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        // Switching to another window blurs the field too; that is not leaving it.
        onBlur={() => document.hasFocus() && cancel()}
        onFocus={(event) => event.currentTarget.select()}
        className={cn(
          "h-7 min-w-0 flex-1 rounded-md bg-[var(--surface-2)] px-2 font-medium outline-none ring-1 ring-[var(--brand)] disabled:opacity-60",
          className,
        )}
      />
    );
  return (
    <>
      <Link
        href={clip.href}
        className={cn(
          "truncate outline-none hover:underline focus-visible:underline",
          className,
        )}
      >
        {shown}
      </Link>
      {editable ? (
        <button
          type="button"
          aria-label={`${st(lang, "clip.rename")}: ${shown}`}
          title={st(lang, "clip.rename")}
          onClick={() => {
            setValue(shown);
            setEditing(true);
          }}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--fg-muted)] opacity-0 outline-none transition-opacity group-hover/card:opacity-100 hover:text-[var(--fg)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--brand)] [@media(pointer:coarse)]:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      ) : null}
    </>
  );
}
