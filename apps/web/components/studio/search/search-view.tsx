"use client";

import { cn } from "cn";
import { Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useLocale } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import { st, stf } from "@/lib/studio/i18n";
import { searchClips, searchNames } from "@/lib/studio/search";
import { useDetails, useDetailsClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { MoreMenu, trackFor } from "../feed/clip-card";
import { LikedTile, PlaylistArt } from "../playlist-art";
import { countLabel } from "../playlists/playlist-view";
import { usePlaylists } from "../playlists-context";
import { SongRow } from "../song-row";

const DEBOUNCE_MS = 200;
const SUGGESTED = 6;

type Entry =
  | { kind: "song"; id: string; clip: Clip }
  | { kind: "playlist"; id: string; name: string; count: number; href: string };

// Searches the owner's own songs (title, style, lyrics, prompt) and playlists. A result song
// plays from its play button and opens in the details panel when its row is clicked; a
// playlist opens its page. Up and Down move through the results, Enter picks one.
export function SearchView({ clips }: { clips: Clip[] }) {
  const lang = useLocale();
  const router = useRouter();
  const { playlists, likedCount } = usePlaylists();
  useDetailsClips(clips);
  const showDetails = useDetails((s) => s.show);
  const detailsId = useDetails((s) => (s.open ? s.selectedId : null));
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const current = usePlayer((s) => s.queue[s.index]?.id);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (text.trim() === query) return;
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, query]);
  // A new query starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight when the query changes.
  useEffect(() => setActive(-1), [query]);

  const searching = text.trim() !== query;
  const system = useMemo(
    () => [
      {
        id: "liked",
        name: st(lang, "pl.liked"),
        songCount: likedCount,
      },
    ],
    [lang, likedCount],
  );
  const songs = useMemo(() => searchClips(clips, query), [clips, query]);
  const lists = useMemo(
    () => searchNames([...system, ...playlists], query),
    [system, playlists, query],
  );
  const entries: Entry[] = useMemo(
    () => [
      ...songs.map((clip): Entry => ({ kind: "song", id: clip.id, clip })),
      ...lists.map(
        (list): Entry => ({
          kind: "playlist",
          id: list.id,
          name: list.name,
          count: list.songCount,
          href: `/playlists/${list.id}`,
        }),
      ),
    ],
    [songs, lists],
  );

  // With no query: the most played songs and the newest ones.
  const top = useMemo(
    () =>
      [...clips]
        .filter((clip) => clip.playCount > 0)
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, SUGGESTED),
    [clips],
  );
  const newest = useMemo(
    () =>
      [...clips]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, SUGGESTED),
    [clips],
  );

  const playClip = (clip: Clip, list: Clip[]) => {
    const track = trackFor(clip);
    if (!track) return showDetails(clip.id);
    if (current === clip.id) return toggle();
    play(
      track,
      list
        .map(trackFor)
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    );
  };
  const activate = (entry: Entry) => {
    if (entry.kind === "song") playClip(entry.clip, songs);
    else router.push(entry.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (entries.length === 0) return;
      event.preventDefault();
      const last = entries.length - 1;
      // Up from nothing wraps to the last entry, Down from nothing goes to the first.
      setActive((prev) =>
        event.key === "ArrowDown"
          ? (prev + 1) % entries.length
          : prev <= 0
            ? last
            : prev - 1,
      );
    } else if (event.key === "Enter") {
      const entry = entries[active];
      if (entry) {
        event.preventDefault();
        activate(entry);
      }
    } else if (event.key === "Escape" && text) {
      event.preventDefault();
      setText("");
      setQuery("");
    }
  };

  useEffect(() => {
    if (active < 0) return;
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const songRow = (clip: Clip, list: Clip[], at: number) => (
    <li key={clip.id} id={`${listId}-${at}`}>
      <SongRow
        clip={clip}
        list={list}
        active={active === at}
        selected={detailsId === clip.id}
        onActivate={() => showDetails(clip.id)}
        trailing={<MoreMenu clip={clip} />}
      />
    </li>
  );

  return (
    <div className="h-full overflow-y-auto pb-24 scrollbar-thin min-[900px]:pb-6">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
        <h1 className="sr-only">{st(lang, "search.title")}</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-[var(--fg-subtle)]" />
          <input
            ref={input}
            type="search"
            // biome-ignore lint/a11y/noAutofocus: the page exists to type a search.
            autoFocus
            value={text}
            aria-label={st(lang, "search.placeholder")}
            placeholder={st(lang, "search.placeholder")}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-12 w-full rounded-full bg-[var(--surface-glass)] pr-12 pl-12 text-[16px] ring-1 ring-[var(--hairline)] outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] [&::-webkit-search-cancel-button]:hidden"
          />
          {searching ? (
            <Loader2 className="absolute top-1/2 right-4 size-4 -translate-y-1/2 animate-spin text-[var(--fg-muted)]" />
          ) : text ? (
            <button
              type="button"
              aria-label={st(lang, "search.clear")}
              onClick={() => {
                setText("");
                setQuery("");
                input.current?.focus();
              }}
              className="absolute top-1/2 right-3 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <p aria-live="polite" className="sr-only">
          {query !== "" && entries.length > 0
            ? active >= 0
              ? ((e) => (e.kind === "song" ? e.clip.title : e.name))(
                  entries[active] as Entry,
                )
              : `${songs.length} / ${lists.length}`
            : ""}
        </p>

        {query === "" ? (
          <div className="mt-8 space-y-8">
            <p className="text-[14px] text-[var(--fg-muted)]">
              {st(lang, "search.hint")}
            </p>
            {top.length > 0 ? (
              <section aria-label={st(lang, "search.top")}>
                <h2 className="mb-2 text-[15px] font-medium">
                  {st(lang, "search.top")}
                </h2>
                <ul>
                  {top.map((clip) => (
                    <li key={clip.id}>
                      <SongRow
                        clip={clip}
                        list={top}
                        selected={detailsId === clip.id}
                        onActivate={() => showDetails(clip.id)}
                        trailing={<MoreMenu clip={clip} />}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {newest.length > 0 ? (
              <section aria-label={st(lang, "search.newest")}>
                <h2 className="mb-2 text-[15px] font-medium">
                  {st(lang, "search.newest")}
                </h2>
                <ul>
                  {newest.map((clip) => (
                    <li key={clip.id}>
                      <SongRow
                        clip={clip}
                        list={newest}
                        selected={detailsId === clip.id}
                        onActivate={() => showDetails(clip.id)}
                        trailing={<MoreMenu clip={clip} />}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : entries.length === 0 ? (
          <p
            role="status"
            className="mt-10 rounded-2xl border border-dashed border-[var(--hairline)] p-8 text-center text-[var(--fg-muted)]"
          >
            {stf(lang, "search.none", { q: query })}
          </p>
        ) : (
          <div id={listId} className="mt-8 space-y-8">
            {songs.length > 0 ? (
              <section aria-label={st(lang, "search.songs")}>
                <h2 className="mb-2 flex items-baseline gap-2 text-[15px] font-medium">
                  {st(lang, "search.songs")}
                  <span className="text-[13px] tabular-nums text-[var(--fg-muted)]">
                    {songs.length}
                  </span>
                </h2>
                <ul>{songs.map((clip, i) => songRow(clip, songs, i))}</ul>
              </section>
            ) : null}
            {lists.length > 0 ? (
              <section aria-label={st(lang, "search.playlists")}>
                <h2 className="mb-2 flex items-baseline gap-2 text-[15px] font-medium">
                  {st(lang, "search.playlists")}
                  <span className="text-[13px] tabular-nums text-[var(--fg-muted)]">
                    {lists.length}
                  </span>
                </h2>
                <ul>
                  {lists.map((list, i) => {
                    const at = songs.length + i;
                    return (
                      <li key={list.id} id={`${listId}-${at}`}>
                        <Link
                          href={`/playlists/${list.id}`}
                          className={cn(
                            "flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5 outline-none hover-glass focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                            active === at && "bg-[var(--surface-glass-hover)]",
                          )}
                        >
                          {list.id === "liked" ? (
                            <LikedTile className="size-11 rounded-lg" />
                          ) : (
                            <PlaylistArt
                              id={list.id}
                              className="size-11 rounded-lg ring-1 ring-[var(--hairline)]"
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium">
                              {list.name}
                            </span>
                            <span className="text-[13px] text-[var(--fg-muted)]">
                              {countLabel(lang, list.songCount)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
