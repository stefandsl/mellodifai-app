"use client";

import { cn } from "cn";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  addToPlaylist,
  createPlaylist,
  removeFromPlaylist,
} from "@/app/actions/playlists";
import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { st, stf } from "@/lib/studio/i18n";
import { createClient } from "@/lib/supabase/browser";
import { usePlaylists } from "./playlists-context";

type Lang = "it" | "en";

// Tells the user what an "add" did: all of it, part of it, or nothing new.
function reportAdded(
  lang: Lang,
  name: string,
  added: number,
  total: number,
): void {
  if (added === 0) toast.warning(stf(lang, "pl.addedNone", { name }));
  else if (added < total)
    toast.warning(
      stf(lang, "pl.addedSome", {
        done: String(added),
        total: String(total),
        name,
      }),
    );
  else
    toast.success(
      total === 1
        ? stf(lang, "pl.addedOne", { name })
        : stf(lang, "pl.addedMany", { n: String(added), name }),
    );
}

// Adds one song, or the whole selection, to a playlist of the user's choice, or to a new one
// made on the spot. With one song, the playlists that hold it show a check and a click takes it
// out again.
export function AddToPlaylistDialog({
  open,
  onOpenChange,
  versionIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionIds: string[];
  // Called after songs were added to a playlist (the feed leaves select mode).
  onDone?: () => void;
}) {
  const lang = useLocale();
  const router = useRouter();
  const { playlists } = usePlaylists();
  const [member, setMember] = useState<Record<string, number> | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const single = versionIds.length === 1;
  const key = versionIds.join(",");

  // Which playlists already hold the songs, read fresh each time the window opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for versionIds.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setMember(null);
    setFailed(false);
    setName("");
    createClient()
      .rpc("playlist_membership", { p_versions: versionIds })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) return setFailed(true);
        setMember(
          Object.fromEntries(
            ((data ?? []) as { playlist_id: string; n: number }[]).map(
              (row) => [row.playlist_id, row.n],
            ),
          ),
        );
      });
    return () => {
      live = false;
    };
  }, [open, key]);

  const choose = async (id: string, listName: string) => {
    const has = (member?.[id] ?? 0) > 0;
    setBusy(id);
    try {
      if (single && has) {
        const result = await removeFromPlaylist({
          playlistId: id,
          versionIds,
        });
        if (!result.ok) throw new Error("remove");
        toast.success(stf(lang, "pl.removedFrom", { name: listName }));
        setMember((prev) => ({ ...prev, [id]: 0 }));
      } else {
        const result = await addToPlaylist({ playlistId: id, versionIds });
        if (!result.ok) throw new Error("add");
        const added = result.count ?? 0;
        reportAdded(lang, listName, added, versionIds.length);
        setMember((prev) => ({
          ...prev,
          [id]: (prev?.[id] ?? 0) + added,
        }));
        if (added > 0) onDone?.();
      }
      router.refresh();
    } catch (error) {
      toast.error(
        st(
          lang,
          error instanceof Error && error.message === "remove"
            ? "pl.removeFailed"
            : "pl.addFailed",
        ),
      );
    }
    setBusy(null);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy("new");
    try {
      const made = await createPlaylist({ name: trimmed });
      if (!made.ok || !made.id) throw new Error("create");
      const result = await addToPlaylist({
        playlistId: made.id,
        versionIds,
      });
      if (!result.ok) throw new Error("add");
      reportAdded(lang, trimmed, result.count ?? 0, versionIds.length);
      onDone?.();
      router.refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        st(
          lang,
          error instanceof Error && error.message === "add"
            ? "pl.addFailed"
            : "pl.createFailed",
        ),
      );
    }
    setBusy(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-4 sm:max-w-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="text-lg">
              {single
                ? st(lang, "pl.addTitle")
                : stf(lang, "pl.addTitleMany", {
                    n: String(versionIds.length),
                  })}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {st(lang, "pl.add")}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label={st(lang, "share.close")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <X className="size-4" />
          </DialogClose>
        </div>

        {failed ? (
          <p role="alert" className="text-[13px] text-[var(--danger)]">
            {st(lang, "pl.loadFailed")}
          </p>
        ) : member === null ? (
          <p className="flex items-center gap-2 text-[13px] text-[var(--fg-muted)]">
            <Loader2 className="size-4 animate-spin" />
            {st(lang, "pl.loading")}
          </p>
        ) : playlists.length === 0 ? (
          <p className="text-[13px] text-[var(--fg-muted)]">
            {st(lang, "pl.noPlaylists")}
          </p>
        ) : (
          <ul className="-mx-1 max-h-64 space-y-0.5 overflow-y-auto px-1 scrollbar-thin">
            {playlists.map((list) => {
              const have = member[list.id] ?? 0;
              const inside = single && have > 0;
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    aria-pressed={single ? inside : undefined}
                    title={inside ? st(lang, "pl.inList") : undefined}
                    onClick={() => void choose(list.id, list.name)}
                    className="flex h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left text-[14px] outline-none transition-colors hover:bg-[var(--surface-glass-hover)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-60"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md ring-1 ring-[var(--hairline)]",
                        inside &&
                          "bg-[var(--brand)] text-[var(--brand-ink)] ring-0",
                      )}
                    >
                      {busy === list.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : inside ? (
                        <Check className="size-3.5" strokeWidth={3} />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{list.name}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-[var(--fg-muted)]">
                      {!single && have > 0
                        ? stf(lang, "pl.inListCount", { n: String(have) })
                        : list.songCount === 1
                          ? st(lang, "pl.countOne")
                          : stf(lang, "pl.countMany", {
                              n: String(list.songCount),
                            })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form
          className="flex gap-2 border-t border-[var(--hairline)] pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            value={name}
            maxLength={100}
            aria-label={st(lang, "pl.nameLabel")}
            placeholder={st(lang, "pl.nameLabel")}
            onChange={(event) => setName(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-full bg-[var(--surface-glass)] px-3.5 text-[14px] ring-1 ring-[var(--hairline)] outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          />
          <button
            type="submit"
            disabled={!name.trim() || busy !== null}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--fg)] px-4 text-[13px] font-medium text-[var(--bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40"
          >
            {busy === "new" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {st(lang, "pl.new")}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
