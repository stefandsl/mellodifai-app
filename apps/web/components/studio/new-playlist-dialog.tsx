"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { createPlaylist } from "@/app/actions/playlists";
import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { st, stf } from "@/lib/studio/i18n";

// Asks for a name, creates the playlist and opens it.
export function NewPlaylistDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const lang = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    let id: string | undefined;
    try {
      const result = await createPlaylist({ name: trimmed });
      if (result.ok) id = result.id;
    } catch {}
    setBusy(false);
    if (!id) return void toast.error(st(lang, "pl.createFailed"));
    toast.success(stf(lang, "pl.created", { name: trimmed }));
    setName("");
    onOpenChange(false);
    router.push(`/playlists/${id}`);
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName("");
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="gap-4 sm:max-w-sm">
        <div className="flex items-start justify-between gap-3">
          <DialogTitle className="text-lg">{st(lang, "pl.new")}</DialogTitle>
          <DialogDescription className="sr-only">
            {st(lang, "pl.nameLabel")}
          </DialogDescription>
          <DialogClose
            aria-label={st(lang, "share.close")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <X className="size-4" />
          </DialogClose>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            value={name}
            maxLength={100}
            autoFocus
            aria-label={st(lang, "pl.nameLabel")}
            placeholder={st(lang, "pl.nameLabel")}
            onChange={(event) => setName(event.target.value)}
            className="h-10 rounded-full bg-[var(--surface-glass)] px-4 text-[14px] ring-1 ring-[var(--hairline)] outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          />
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="bg-cta inline-flex h-10 items-center justify-center gap-2 rounded-full text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {st(lang, "pl.create")}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
