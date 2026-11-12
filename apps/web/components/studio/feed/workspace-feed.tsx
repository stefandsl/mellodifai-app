"use client";

import { cn } from "cn";
import {
  ChevronLeft,
  ChevronRight,
  FileUp,
  LayoutGrid,
  List,
  ListChecks,
  ListMusic,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useLocale } from "@/components/locale-provider";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Clip, isGenerating, needsAction } from "@/lib/studio/clips";
import { st, stf } from "@/lib/studio/i18n";
import { matchClip } from "@/lib/studio/search";
import { restoreSongs, trashSongs } from "@/lib/studio/trash-actions";
import { useDetailsClips } from "@/store/details";
import { useImportDialog } from "@/store/import-dialog";
import { useReactions } from "@/store/reactions";
import { AddToPlaylistDialog } from "../playlist-dialog";
import { ClipCard } from "./clip-card";
import { useLiveRefresh } from "./use-live-refresh";

type Sort = "new" | "old" | "title";
export const FILTERS = [
  "action",
  "video",
  "audio",
  "liked",
  "creating",
  "audioOnly",
] as const;
export type Filter = (typeof FILTERS)[number];
const PAGE = 20;

export const MATCH: Record<Filter, (clip: Clip) => boolean> = {
  action: (clip) => needsAction(clip.status),
  video: (clip) =>
    Boolean(clip.videoUrl) ||
    Boolean(clip.visualizers?.some((item) => item.url)),
  audio: (clip) => Boolean(clip.audioUrl),
  liked: (clip) => clip.reaction === "like",
  creating: (clip) => isGenerating(clip.status),
  audioOnly: (clip) => clip.status === "audio_ready",
};

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(
  iso: string,
  lang: "it" | "en",
  now = new Date(),
): string {
  const d = new Date(iso);
  const start = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return st(lang, "feed.today");
  if (diff === 1) return st(lang, "feed.yesterday");
  const text = d.toLocaleDateString(lang === "it" ? "it-IT" : "en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function usePersisted<T extends string>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) setValue(stored as T);
    } catch {}
  }, [key]);
  return [
    value,
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {}
    },
  ] as const;
}

const PILL =
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

export function WorkspaceFeed({
  clips,
  initialFilters = [],
  heading,
  trash = false,
  trashLink = false,
}: {
  clips: Clip[];
  initialFilters?: Filter[];
  heading?: string;
  // The Library trash: songs here can only be restored.
  trash?: boolean;
  // Show the link between the Library and its trash (the Library page only).
  trashLink?: boolean;
}) {
  const lang = useLocale();
  const router = useRouter();
  useLiveRefresh();
  useDetailsClips(clips);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = usePersisted<Sort>("mellodifai-feed-sort", "new");
  const [view, setView] = usePersisted<"list" | "grid">(
    "mellodifai-feed-view",
    "list",
  );
  const [filters, setFilters] = useState<Filter[]>(initialFilters);
  const [page, setPage] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // Songs moved to or out of the trash, hidden until the refreshed data arrives.
  const [gone, setGone] = useState<Set<string>>(new Set());

  // Fresh data from the server is the truth for likes, and ends the optimistic hiding.
  useEffect(() => {
    useReactions
      .getState()
      .sync(clips.map((clip) => ({ id: clip.id, reaction: clip.reaction })));
    setGone(new Set());
  }, [clips]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query, filter or sort starts at page one.
  useEffect(() => setPage(0), [debounced, filters, sort]);

  const visible = useMemo(() => {
    const matched = clips.filter((clip) => {
      if (gone.has(clip.id)) return false;
      if (debounced && !matchClip(clip, debounced)) return false;
      return filters.every((filter) => MATCH[filter](clip));
    });
    return matched.sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "old"
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
    );
  }, [clips, gone, debounced, filters, sort]);

  // Only songs on screen can be acted on: a filter change never leaves hidden picks behind.
  const picked = useMemo(
    () =>
      visible.filter((clip) => selected.has(clip.id)).map((clip) => clip.id),
    [visible, selected],
  );
  const toggleSelecting = () => {
    setSelecting(!selecting);
    setSelected(new Set());
  };
  const togglePick = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const hide = (ids: string[]) => setGone((prev) => new Set([...prev, ...ids]));
  const applyToPicked = async () => {
    setBusy(true);
    const moved = await (trash ? restoreSongs : trashSongs)(picked, lang, {
      refresh: router.refresh,
      onMoved: hide,
    });
    setBusy(false);
    if (moved > 0) setSelected(new Set());
  };

  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const shown = visible.slice(page * PAGE, page * PAGE + PAGE);
  const groups = useMemo(() => {
    if (sort === "title") return [{ key: "all", label: "", items: shown }];
    const out: { key: string; label: string; items: Clip[] }[] = [];
    for (const clip of shown) {
      const key = dayKey(clip.createdAt);
      const last = out.at(-1);
      if (last?.key === key) last.items.push(clip);
      else
        out.push({ key, label: dayLabel(clip.createdAt, lang), items: [clip] });
    }
    return out;
  }, [shown, sort, lang]);

  const toggleFilter = (filter: Filter) =>
    setFilters(
      filters.includes(filter)
        ? filters.filter((f) => f !== filter)
        : [...filters, filter],
    );

  return (
    <section
      aria-label={st(lang, "feed.workspace")}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="shrink-0 space-y-3 px-4 pt-4 pb-2 sm:px-6">
        <nav
          aria-label={st(lang, "feed.breadcrumb")}
          className="flex items-center gap-1.5 text-[15px]"
        >
          <span className="text-[var(--fg-muted)]">
            {st(lang, "feed.workspaces")}
          </span>
          <ChevronRight className="size-4 text-[var(--fg-subtle)]" />
          <span className="font-medium">
            {heading ?? st(lang, "feed.workspace")}
          </span>
          {trash ? null : (
            <button
              type="button"
              aria-label={st(lang, "imp.open")}
              onClick={() => useImportDialog.getState().show()}
              className={cn(
                PILL,
                "ml-auto bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
            >
              <FileUp className="size-3.5" />
              <span className="sm:hidden">{st(lang, "imp.openShort")}</span>
              <span className="hidden sm:inline">{st(lang, "imp.open")}</span>
            </button>
          )}
          {trashLink ? (
            <Link
              href={trash ? "/library" : "/library?tab=trash"}
              className={cn(
                PILL,
                trash && "ml-auto",
                "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
            >
              {trash ? (
                <Undo2 className="size-3.5" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {st(lang, trash ? "trash.back" : "nav.trash")}
            </Link>
          ) : null}
        </nav>
        {trash ? (
          <p className="text-[13px] text-[var(--fg-muted)]">
            {st(lang, "trash.note")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1 max-sm:basis-full">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--fg-subtle)]" />
            <input
              type="search"
              value={query}
              aria-label={st(lang, "feed.search")}
              placeholder={st(lang, "feed.search")}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-full rounded-full bg-[var(--surface-glass)] pr-3 pl-9 ring-1 ring-[var(--hairline)] outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                PILL,
                "bg-[var(--surface-2)] hover:text-[var(--fg)]",
              )}
            >
              <SlidersHorizontal className="size-3.5" />
              {st(lang, "feed.filters")}
              {filters.length ? ` (${filters.length})` : ""}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-2xl p-1.5">
              {FILTERS.map((filter) => (
                <DropdownMenuCheckboxItem
                  key={filter}
                  checked={filters.includes(filter)}
                  closeOnClick={false}
                  onCheckedChange={() => toggleFilter(filter)}
                  className="rounded-lg"
                >
                  {st(lang, `filter.${filter}`)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={st(lang, "feed.sort")}
              className={cn(PILL, "bg-[var(--surface-2)]")}
            >
              {st(lang, `sort.${sort}`)}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 rounded-2xl p-1.5">
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => setSort(value as Sort)}
              >
                {(["new", "old", "title"] as const).map((value) => (
                  <DropdownMenuRadioItem
                    key={value}
                    value={value}
                    className="rounded-lg"
                  >
                    {st(lang, `sort.${value}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-pressed={selecting}
            onClick={toggleSelecting}
            className={cn(
              PILL,
              selecting
                ? "bg-[var(--fg)] text-[var(--bg)]"
                : "bg-[var(--surface-2)] hover:text-[var(--fg)]",
            )}
          >
            <ListChecks className="size-3.5" />
            {st(lang, "feed.select")}
          </button>
          <div
            role="radiogroup"
            aria-label={`${st(lang, "feed.list")} / ${st(lang, "feed.grid")}`}
            className="inline-flex rounded-full bg-[var(--surface-2)] p-0.5"
          >
            {(
              [
                ["list", <List key="l" className="size-4" />],
                ["grid", <LayoutGrid key="g" className="size-4" />],
              ] as const
            ).map(([value, icon]) => (
              // biome-ignore lint/a11y/useSemanticElements: a styled segmented control; arrow-key order is not needed for two options.
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={view === value}
                aria-label={st(
                  lang,
                  value === "list" ? "feed.list" : "feed.grid",
                )}
                onClick={() => setView(value)}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                  view === value
                    ? "bg-[var(--fg)] text-[var(--bg)]"
                    : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
                )}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden gap-1.5 overflow-x-auto scrollbar-none sm:flex">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={filters.includes(filter)}
              onClick={() => toggleFilter(filter)}
              className={cn(
                PILL,
                "h-7 shrink-0 text-xs",
                filters.includes(filter)
                  ? "bg-[var(--fg)] text-[var(--bg)]"
                  : "bg-[var(--surface-glass)] text-[var(--fg-muted)] ring-1 ring-[var(--hairline)] hover:text-[var(--fg)]",
              )}
            >
              {st(lang, `filter.${filter}`)}
            </button>
          ))}
        </div>
        {selecting ? (
          <div
            role="toolbar"
            aria-label={st(lang, "feed.select")}
            className="flex flex-wrap items-center gap-2 text-[13px]"
          >
            <span
              aria-live="polite"
              className="tabular-nums text-[var(--fg-muted)]"
            >
              {picked.length === 1
                ? st(lang, "feed.selectedOne")
                : stf(lang, "feed.selectedMany", { n: String(picked.length) })}
            </span>
            <button
              type="button"
              disabled={
                visible.length === 0 || picked.length === visible.length
              }
              onClick={() =>
                setSelected(new Set(visible.map((clip) => clip.id)))
              }
              className={cn(
                PILL,
                "h-7 bg-[var(--surface-2)] text-xs disabled:opacity-40",
              )}
            >
              {st(lang, "feed.selectAll")}
            </button>
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => setSelected(new Set())}
              className={cn(
                PILL,
                "h-7 bg-[var(--surface-2)] text-xs disabled:opacity-40",
              )}
            >
              {st(lang, "feed.selectNone")}
            </button>
            {trash ? null : (
              <button
                type="button"
                disabled={picked.length === 0}
                onClick={() => setListOpen(true)}
                className={cn(
                  PILL,
                  "h-7 bg-[var(--surface-2)] text-xs disabled:opacity-40",
                )}
              >
                <ListMusic className="size-3.5" />
                {st(lang, "pl.add")}
              </button>
            )}
            <button
              type="button"
              disabled={picked.length === 0 || busy}
              onClick={() => void applyToPicked()}
              className={cn(
                PILL,
                "h-7 text-xs disabled:opacity-40",
                trash
                  ? "bg-[var(--fg)] text-[var(--bg)]"
                  : "bg-[color-mix(in_oklab,var(--danger),transparent_82%)] text-[var(--danger)]",
              )}
            >
              {trash ? (
                <Undo2 className="size-3.5" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {st(lang, trash ? "feed.restoreSelected" : "feed.trashSelected")}
            </button>
          </div>
        ) : null}
        {selecting && !trash ? (
          <AddToPlaylistDialog
            open={listOpen}
            onOpenChange={setListOpen}
            versionIds={picked}
            onDone={() => {
              setSelected(new Set());
              setSelecting(false);
            }}
          />
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-24 scrollbar-thin sm:px-4 min-[900px]:pb-6">
        {visible.length === 0 ? (
          <p className="mx-2 mt-10 rounded-2xl border border-dashed border-[var(--hairline)] p-8 text-center text-[var(--fg-muted)]">
            {st(
              lang,
              clips.length === 0
                ? trash
                  ? "trash.empty"
                  : "feed.empty"
                : "feed.noMatch",
            )}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              {group.label ? (
                <h2 className="studio-date-heading sticky top-0 z-10 bg-[var(--bg)]/90 px-3 py-2 text-[13px] font-medium text-[var(--fg-muted)] backdrop-blur">
                  {group.label}
                </h2>
              ) : null}
              <div
                className={cn(
                  view === "grid"
                    ? "grid grid-cols-2 gap-1 md:grid-cols-3 2xl:grid-cols-4"
                    : "space-y-0.5",
                )}
              >
                {group.items.map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    list={visible}
                    view={view}
                    trash={trash}
                    onMoved={hide}
                    selection={
                      selecting
                        ? {
                            selected: selected.has(clip.id),
                            onToggle: () => togglePick(clip.id),
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ))
        )}
        {pages > 1 ? (
          <nav
            aria-label={st(lang, "feed.page")}
            className="mt-4 flex items-center justify-center gap-2 text-[13px]"
          >
            <button
              type="button"
              aria-label={st(lang, "feed.prev")}
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--surface-2)] disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="tabular-nums text-[var(--fg-muted)]">
              {page + 1} / {pages}
            </span>
            <button
              type="button"
              aria-label={st(lang, "feed.next")}
              disabled={page >= pages - 1}
              onClick={() => setPage(page + 1)}
              className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--surface-2)] disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </nav>
        ) : null}
      </div>
    </section>
  );
}
