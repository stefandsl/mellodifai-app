"use client";

import { cn } from "cn";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Heart,
  Info,
  ListMusic,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { setReaction } from "@/app/actions/library";
import {
  addToPlaylist,
  deletePlaylist,
  removeFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
} from "@/app/actions/playlists";
import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Clip } from "@/lib/studio/clips";
import { st, stf } from "@/lib/studio/i18n";
import type { PlaylistInfo } from "@/lib/studio/playlists";
import { useDetails, useDetailsClips } from "@/store/details";
import { type Track, usePlayer } from "@/store/player";
import { trackFor } from "../feed/clip-card";
import { LikedTile, PlaylistArt } from "../playlist-art";
import { AddToPlaylistDialog } from "../playlist-dialog";
import { ShareDialog } from "../share-dialog";
import { SongRow } from "../song-row";

const ICON_BUTTON =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none transition-colors hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40";

export function countLabel(lang: "it" | "en", n: number): string {
  return n === 1
    ? st(lang, "pl.countOne")
    : stf(lang, "pl.countMany", { n: String(n) });
}

// The playlist's name, with a pencil that turns it into an input: Enter saves, Escape or
// leaving the field cancels.
function NameEditor({ playlist }: { playlist: PlaylistInfo }) {
  const lang = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(playlist.name);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const save = async () => {
    const next = value.trim();
    if (!next || next === playlist.name) return setEditing(false);
    setBusy(true);
    let ok = false;
    try {
      ok = (await renamePlaylist({ playlistId: playlist.id, name: next })).ok;
    } catch {}
    setBusy(false);
    if (!ok) {
      toast.error(st(lang, "pl.renameFailed"));
      return input.current?.focus();
    }
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
        aria-label={st(lang, "pl.rename")}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            if (!busy) setEditing(false);
          }
        }}
        onBlur={() => document.hasFocus() && !busy && setEditing(false)}
        onFocus={(event) => event.currentTarget.select()}
        className="h-12 w-full min-w-0 rounded-xl bg-[var(--surface-2)] px-3 text-3xl font-medium tracking-tight outline-none ring-1 ring-[var(--brand)] disabled:opacity-60 sm:text-4xl"
      />
    );
  return (
    <div className="flex min-w-0 items-center gap-2">
      <h1 className="min-w-0 truncate text-3xl font-medium tracking-tight sm:text-4xl">
        {playlist.name}
      </h1>
      <button
        type="button"
        aria-label={`${st(lang, "pl.rename")}: ${playlist.name}`}
        title={st(lang, "pl.rename")}
        onClick={() => {
          setValue(playlist.name);
          setEditing(true);
        }}
        className={ICON_BUTTON}
      >
        <Pencil className="size-4" />
      </button>
    </div>
  );
}

function DeleteDialog({
  playlist,
  open,
  onOpenChange,
}: {
  playlist: PlaylistInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const lang = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    let ok = false;
    try {
      ok = (await deletePlaylist({ playlistId: playlist.id })).ok;
    } catch {}
    setBusy(false);
    if (!ok) return void toast.error(st(lang, "pl.deleteFailed"));
    toast.success(st(lang, "pl.deleted"));
    onOpenChange(false);
    router.push("/playlists");
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-4 sm:max-w-sm">
        <DialogTitle className="text-lg">
          {stf(lang, "pl.deleteTitle", { name: playlist.name })}
        </DialogTitle>
        <DialogDescription>{st(lang, "pl.deleteBody")}</DialogDescription>
        <div className="flex justify-end gap-2">
          <DialogClose
            disabled={busy}
            className="inline-flex h-9 items-center rounded-full bg-[var(--surface-2)] px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            {st(lang, "pl.cancel")}
          </DialogClose>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--danger)] px-4 text-[13px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {st(lang, "pl.deleteConfirm")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The "..." menu of a row: details, queue, other playlists, share, order, and taking the song
// out of this list (or, in "Mi piace", unliking it).
function RowMenu({
  clip,
  system,
  first,
  last,
  onMove,
  onRemove,
}: {
  clip: Clip;
  system: boolean;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const lang = useLocale();
  const enqueue = usePlayer((s) => s.enqueue);
  const showDetails = useDetails((s) => s.show);
  const track = trackFor(clip);
  const [shareOpen, setShareOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${st(lang, "clip.more")}: ${clip.title}`}
          className={ICON_BUTTON}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1.5">
          <DropdownMenuItem
            onClick={() => showDetails(clip.id)}
            className="rounded-lg"
          >
            <Info />
            {st(lang, "clip.details")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!track}
            onClick={() => {
              if (!track) return;
              enqueue(track);
              toast.success(st(lang, "clip.added"));
            }}
            className="rounded-lg"
          >
            <ListPlus />
            {st(lang, "clip.addQueue")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setListOpen(true)}
            className="rounded-lg"
          >
            <ListMusic />
            {st(lang, "pl.add")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setShareOpen(true)}
            className="rounded-lg"
          >
            <Share2 />
            {st(lang, "clip.share")}
          </DropdownMenuItem>
          {system ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={first}
                onClick={() => onMove(-1)}
                className="rounded-lg"
              >
                <ArrowUp />
                {st(lang, "pl.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={last}
                onClick={() => onMove(1)}
                className="rounded-lg"
              >
                <ArrowDown />
                {st(lang, "pl.moveDown")}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onRemove}
            className="rounded-lg text-[var(--danger)]"
          >
            {system ? <Heart /> : <X />}
            {st(lang, system ? "pl.unlike" : "pl.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={clip.title || st(lang, "clip.untitled")}
        href={clip.href}
      />
      <AddToPlaylistDialog
        open={listOpen}
        onOpenChange={setListOpen}
        versionIds={[clip.id]}
      />
    </>
  );
}

// A playlist page: the songs in order, played in order through the player queue. "Mi piace"
// is the same page over the liked songs (newest like first), where taking a song out unlikes it.
export function PlaylistView({
  playlist,
  clips,
  system,
}: {
  playlist: PlaylistInfo;
  clips: Clip[];
  system: boolean;
}) {
  const lang = useLocale();
  const router = useRouter();
  useDetailsClips(clips);
  const detailsId = useDetails((s) => (s.open ? s.selectedId : null));
  const [items, setItems] = useState(clips);
  const [deleting, setDeleting] = useState(false);
  const [drag, setDrag] = useState<{
    from: string;
    over: string | null;
  } | null>(null);
  // Fresh data from the server replaces the local order.
  useEffect(() => setItems(clips), [clips]);

  const tracks = useMemo(
    () => items.map(trackFor).filter((item): item is Track => item !== null),
    [items],
  );
  const playingHere = usePlayer((s) => {
    const id = s.queue[s.index]?.id;
    return Boolean(id) && items.some((clip) => clip.id === id);
  });
  const playing = usePlayer((s) => s.playing) && playingHere;
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);

  const playAll = () => {
    if (playingHere) return toggle();
    const first = tracks[0];
    if (!first) return toast.error(st(lang, "pl.noPlayable"));
    play(first, tracks);
  };

  // Moves a song to a position and saves the whole order; a refused save puts it back.
  const reorder = async (id: string, to: number) => {
    const from = items.findIndex((clip) => clip.id === id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const before = items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    setItems(next);
    let ok = false;
    try {
      ok = (
        await reorderPlaylist({
          playlistId: playlist.id,
          versionIds: next.map((clip) => clip.id),
        })
      ).ok;
    } catch {}
    if (!ok) {
      setItems(before);
      return void toast.error(st(lang, "pl.reorderFailed"));
    }
    router.refresh();
  };

  const remove = async (clip: Clip) => {
    const before = items;
    setItems(items.filter((item) => item.id !== clip.id));
    let ok = false;
    try {
      ok = system
        ? (await setReaction({ versionId: clip.id, reaction: "none" })).ok
        : (
            await removeFromPlaylist({
              playlistId: playlist.id,
              versionIds: [clip.id],
            })
          ).ok;
    } catch {}
    if (!ok) {
      setItems(before);
      return void toast.error(
        st(lang, system ? "clip.reactFailed" : "pl.removeFailed"),
      );
    }
    router.refresh();
    toast.success(st(lang, system ? "pl.unliked" : "pl.removed"), {
      action: {
        label: st(lang, "pl.undo"),
        onClick: async () => {
          try {
            if (system)
              await setReaction({ versionId: clip.id, reaction: "like" });
            else {
              await addToPlaylist({
                playlistId: playlist.id,
                versionIds: [clip.id],
              });
              await reorderPlaylist({
                playlistId: playlist.id,
                versionIds: before.map((item) => item.id),
              });
            }
          } catch {
            toast.error(st(lang, "pl.addFailed"));
          }
          router.refresh();
        },
      },
    });
  };

  return (
    <div className="h-full overflow-y-auto pb-24 scrollbar-thin min-[900px]:pb-6">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
          {system ? (
            <LikedTile className="size-36 rounded-2xl shadow-xl sm:size-48" />
          ) : (
            <PlaylistArt
              id={playlist.id}
              className="size-36 rounded-2xl shadow-xl ring-1 ring-[var(--hairline)] sm:size-48"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold tracking-[0.14em] text-[var(--fg-muted)]">
              {st(lang, "pl.eyebrow")}
            </p>
            <div className="mt-1">
              {system ? (
                <h1 className="truncate text-3xl font-medium tracking-tight sm:text-4xl">
                  {playlist.name}
                </h1>
              ) : (
                <NameEditor
                  playlist={{ ...playlist, songCount: items.length }}
                />
              )}
            </div>
            <p className="mt-2 text-[14px] text-[var(--fg-muted)]">
              {countLabel(lang, items.length)}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                disabled={tracks.length === 0}
                aria-label={st(lang, playing ? "clip.pause" : "pl.play")}
                onClick={playAll}
                className="bg-cta inline-flex size-12 items-center justify-center rounded-full text-white shadow-[0_10px_30px_-10px_var(--brand)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-40 disabled:hover:scale-100"
              >
                {playing ? (
                  <Pause className="size-5 fill-current" />
                ) : (
                  <Play className="size-5 translate-x-0.5 fill-current" />
                )}
              </button>
              {system ? null : (
                <button
                  type="button"
                  aria-label={st(lang, "pl.delete")}
                  title={st(lang, "pl.delete")}
                  onClick={() => setDeleting(true)}
                  className={cn(ICON_BUTTON, "size-10")}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </div>
        </header>

        {items.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-[var(--hairline)] p-8 text-center text-[var(--fg-muted)]">
            <p>{st(lang, system ? "pl.emptyLiked" : "pl.empty")}</p>
            {system ? (
              <Link
                href="/create"
                className="mt-3 inline-flex text-[14px] font-medium text-[var(--brand)] underline-offset-4 hover:underline"
              >
                {st(lang, "pl.emptyLink")}
              </Link>
            ) : null}
          </div>
        ) : (
          <ol
            aria-label={playlist.name}
            className="mt-8 space-y-0.5"
            onDragEnd={() => setDrag(null)}
          >
            {items.map((clip, i) => (
              <li key={clip.id}>
                <SongRow
                  clip={clip}
                  list={items}
                  index={i + 1}
                  selected={detailsId === clip.id}
                  className={cn(
                    drag?.over === clip.id &&
                      drag.from !== clip.id &&
                      "ring-1 ring-[var(--brand)]",
                    drag?.from === clip.id && "opacity-50",
                  )}
                  rowProps={
                    system
                      ? undefined
                      : {
                          draggable: true,
                          onDragStart: (event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", clip.id);
                            setDrag({ from: clip.id, over: null });
                          },
                          onDragOver: (event) => {
                            if (!drag) return;
                            event.preventDefault();
                            if (drag.over !== clip.id)
                              setDrag({ from: drag.from, over: clip.id });
                          },
                          onDrop: (event) => {
                            event.preventDefault();
                            if (!drag) return;
                            const to = items.findIndex(
                              (item) => item.id === clip.id,
                            );
                            const from = drag.from;
                            setDrag(null);
                            void reorder(from, to);
                          },
                        }
                  }
                  trailing={
                    <div className="flex shrink-0 items-center gap-0.5">
                      {system ? (
                        <button
                          type="button"
                          aria-label={`${st(lang, "pl.unlike")}: ${clip.title}`}
                          title={st(lang, "pl.unlike")}
                          onClick={() => void remove(clip)}
                          className={cn(ICON_BUTTON, "text-[var(--brand)]")}
                        >
                          <Heart className="size-4 fill-current" />
                        </button>
                      ) : (
                        <span
                          aria-hidden
                          title={st(lang, "pl.dragHandle")}
                          className="hidden cursor-grab px-1 text-[var(--fg-subtle)] group-hover/row:inline-flex max-sm:!hidden"
                        >
                          <GripVertical className="size-4" />
                        </span>
                      )}
                      <RowMenu
                        clip={clip}
                        system={system}
                        first={i === 0}
                        last={i === items.length - 1}
                        onMove={(delta) => void reorder(clip.id, i + delta)}
                        onRemove={() => void remove(clip)}
                      />
                    </div>
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </div>
      {system ? null : (
        <DeleteDialog
          playlist={playlist}
          open={deleting}
          onOpenChange={setDeleting}
        />
      )}
    </div>
  );
}
