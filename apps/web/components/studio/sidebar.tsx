"use client";

import { cn } from "cn";
import {
  CircleDollarSign,
  Film,
  Languages,
  Library,
  ListMusic,
  LogOut,
  Moon,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useLocale } from "@/components/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { clearComposerDraft } from "@/lib/site/composer-draft";
import { st } from "@/lib/studio/i18n";
import { createClient } from "@/lib/supabase/browser";
import { NewPlaylistDialog } from "./new-playlist-dialog";
import { LikedTile, PlaylistArt } from "./playlist-art";
import { usePlaylists } from "./playlists-context";
import { Tip } from "./ui";
import { useWorkerState } from "./worker-state";

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      {/* The owner's gramophone mark (public/brand), red on transparent for both themes. */}
      <Image
        src="/brand/mellodifai-logo.png"
        alt=""
        width={42}
        height={42}
        priority
        className="size-[42px] shrink-0"
      />
      {compact ? null : (
        <span className="text-[17px] font-semibold tracking-tight">
          Mellodif<span className="text-[var(--brand)]">AI</span>
        </span>
      )}
    </span>
  );
}

const NAV = [
  { href: "/create", key: "nav.create", icon: Music2 },
  { href: "/library", key: "nav.library", icon: Library },
  { href: "/playlists", key: "nav.playlists", icon: ListMusic },
  { href: "/search", key: "nav.search", icon: Search },
  { href: "/library?tab=videos", key: "nav.videos", icon: Film },
  { href: "/credits", key: "nav.credits", icon: CircleDollarSign },
  { href: "/settings", key: "nav.settings", icon: Settings },
] as const;

function isActive(href: string, pathname: string, tab: string | null) {
  const [path, query] = href.split("?");
  // A playlist page belongs to the Playlist entry.
  if (
    path === "/playlists"
      ? !pathname.startsWith("/playlists")
      : pathname !== path
  )
    return false;
  return query ? query === `tab=${tab}` : !tab || path !== "/library";
}

// The playlists under the main entries: "Mi piace" first, then the user's own, and a button to
// make a new one. Shown when the sidebar is wide; the Playlist entry covers the narrow rail.
function PlaylistList({ collapsed }: { collapsed: boolean }) {
  const lang = useLocale();
  const pathname = usePathname();
  const { playlists, likedCount } = usePlaylists();
  const [creating, setCreating] = useState(false);
  const item =
    "flex h-9 items-center gap-2.5 rounded-full px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
  const entries = [
    { id: "liked", name: st(lang, "pl.liked"), count: likedCount },
    ...playlists.map((list) => ({
      id: list.id,
      name: list.name,
      count: list.songCount,
    })),
  ];
  return (
    <div
      className={cn(
        "mt-5 hidden min-h-0 flex-1 flex-col overflow-hidden",
        !collapsed && "tall:xl:flex",
      )}
    >
      <div className="mb-1 flex items-center justify-between px-3">
        <h2 className="text-[11px] font-semibold tracking-wide text-[var(--fg-subtle)] uppercase">
          {st(lang, "nav.yourPlaylists")}
        </h2>
        <button
          type="button"
          aria-label={st(lang, "pl.new")}
          title={st(lang, "pl.new")}
          onClick={() => setCreating(true)}
          className="inline-flex size-6 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <ul className="min-h-0 space-y-0.5 overflow-y-auto scrollbar-thin">
        {entries.map((entry) => {
          const href = `/playlists/${entry.id}`;
          const active = pathname === href;
          return (
            <li key={entry.id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  item,
                  active
                    ? "bg-[var(--surface-glass-hover)] text-[var(--fg)]"
                    : "text-[var(--fg-muted)] hover:bg-[var(--surface-glass)] hover:text-[var(--fg)]",
                )}
              >
                {entry.id === "liked" ? (
                  <LikedTile className="size-5 rounded-md [&_svg]:size-3" />
                ) : (
                  <PlaylistArt id={entry.id} className="size-5 rounded-md" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-[var(--fg-subtle)]">
                  {entry.count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => setCreating(true)}
        className={cn(
          item,
          "mt-1 text-[var(--fg-muted)] hover:bg-[var(--surface-glass)] hover:text-[var(--fg)]",
        )}
      >
        <Plus className="size-4" />
        {st(lang, "pl.new")}
      </button>
      <NewPlaylistDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function StudioSidebar({ email }: { email: string }) {
  const lang = useLocale();
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const worker = useWorkerState();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("mellodifai-sidebar") === "collapsed");
    } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(
        "mellodifai-sidebar",
        collapsed ? "open" : "collapsed",
      );
    } catch {}
  };
  const dark = theme !== "light";

  const row =
    "flex h-10 items-center gap-3 rounded-full px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)] [&_svg]:size-5 [&_svg]:shrink-0";
  const iconRow =
    "inline-flex h-10 w-11 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none transition-colors hover:bg-[var(--surface-glass)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] [&_svg]:size-5";
  const tipSide = collapsed ? "right" : "top";
  const wrap = (label: string, node: React.ReactElement) =>
    collapsed ? (
      <Tip key={label} label={label} side="right">
        {node}
      </Tip>
    ) : (
      node
    );

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "studio-sidebar group/sidebar hidden h-full shrink-0 flex-col overflow-x-hidden overflow-y-auto scrollbar-thin border-r border-[var(--hairline)] bg-[var(--bg)] px-3 pt-4 pb-3 min-[900px]:flex",
        "w-[72px] xl:w-[var(--sidebar-w)]",
        collapsed && "xl:w-[72px]",
      )}
    >
      <div className="mb-6 flex items-center justify-between px-1.5">
        <Link
          href="/create"
          aria-label="mellodifai"
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <span className={cn("xl:hidden", collapsed && "xl:block")}>
            <Logo compact />
          </span>
          <span className={cn("hidden xl:block", collapsed && "xl:hidden")}>
            <Logo />
          </span>
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={st(lang, collapsed ? "nav.expand" : "nav.collapse")}
          className={cn(
            "hidden size-7 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] xl:inline-flex",
            collapsed && "xl:hidden",
          )}
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      {collapsed ? (
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={st(lang, "nav.expand")}
          className="mb-2 hidden size-10 items-center justify-center self-center rounded-full text-[var(--fg-muted)] hover:text-[var(--fg)] xl:inline-flex"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      ) : null}

      <nav aria-label={st(lang, "nav.main")} className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = isActive(item.href, pathname, tab);
          const label = st(lang, item.key);
          const Icon = item.icon;
          return wrap(
            label,
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                row,
                active
                  ? "bg-[var(--surface-glass-hover)] text-[var(--fg)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-glass)] hover:text-[var(--fg)]",
              )}
            >
              <Icon
                className={cn(
                  active && item.href === "/create" && "text-[var(--brand)]",
                )}
              />
              <span
                className={cn("hidden xl:inline", collapsed && "xl:hidden")}
              >
                {label}
              </span>
            </Link>,
          );
        })}
      </nav>

      <PlaylistList collapsed={collapsed} />

      <div className="mt-auto flex flex-col gap-0.5">
        {wrap(
          worker.online
            ? st(lang, "worker.online")
            : st(lang, "worker.offline"),
          <Link
            href="/credits"
            className={cn(
              row,
              "h-auto py-2 text-[var(--fg-muted)] hover:bg-[var(--surface-glass)]",
            )}
          >
            <span className="flex size-5 items-center justify-center">
              <span
                className={cn(
                  "size-2 rounded-full",
                  worker.online
                    ? "bg-[var(--success)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--success),transparent_75%)]"
                    : "bg-[var(--fg-subtle)]",
                )}
              />
            </span>
            <span
              className={cn(
                "hidden min-w-0 flex-col xl:flex",
                collapsed && "xl:hidden",
              )}
            >
              <span className="text-xs text-[var(--fg)]">
                {worker.online
                  ? st(lang, "worker.online")
                  : st(lang, "worker.offline")}
              </span>
              <span className="text-xs tabular-nums">
                {worker.balance ?? "-"} {st(lang, "credits.balance")}
              </span>
            </span>
          </Link>,
        )}
        <div className="my-2 h-px bg-[var(--hairline)]" />
        {/* Theme, language and sign-out are icons: one row when the sidebar is wide, a column on
            the rail, so the footer stays short enough for a low window. */}
        <div
          className={cn(
            "flex flex-col gap-0.5 xl:flex-row xl:gap-1",
            collapsed && "xl:flex-col xl:gap-0.5",
          )}
        >
          <Tip
            label={st(lang, dark ? "theme.light" : "theme.dark")}
            side={tipSide}
          >
            <button
              type="button"
              aria-label={st(lang, dark ? "theme.light" : "theme.dark")}
              onClick={() => setTheme(dark ? "light" : "dark")}
              className={iconRow}
            >
              {dark ? <Sun /> : <Moon />}
            </button>
          </Tip>
          <Tip label={st(lang, "lang.switch")} side={tipSide}>
            <button
              type="button"
              aria-label={st(lang, "lang.switch")}
              onClick={() => {
                // biome-ignore lint/suspicious/noDocumentCookie: locale persistence needs a browser cookie.
                document.cookie = `mellodifai_lang=${lang === "it" ? "en" : "it"}; path=/; max-age=31536000`;
                router.refresh();
              }}
              className={iconRow}
            >
              <Languages />
            </button>
          </Tip>
          <Tip label={`${st(lang, "nav.signOut")} (${email})`} side={tipSide}>
            <button
              type="button"
              aria-label={`${st(lang, "nav.signOut")} (${email})`}
              onClick={async () => {
                clearComposerDraft();
                await createClient().auth.signOut();
                router.push("/login");
                router.refresh();
              }}
              className={iconRow}
            >
              <LogOut />
            </button>
          </Tip>
        </div>
      </div>
    </aside>
  );
}

// Below 900px the sidebar becomes a top bar with icon links.
export function MobileTopBar() {
  const lang = useLocale();
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--hairline)] px-4 min-[900px]:hidden">
      <Link href="/create" aria-label="mellodifai">
        <span className="sm:hidden">
          <Logo compact />
        </span>
        <span className="max-sm:hidden">
          <Logo />
        </span>
      </Link>
      <nav
        aria-label={st(lang, "nav.main")}
        className="flex items-center gap-1"
      >
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href, pathname, tab);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={st(lang, item.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-full",
                active
                  ? "bg-[var(--surface-glass-hover)] text-[var(--fg)]"
                  : "text-[var(--fg-muted)]",
              )}
            >
              <Icon className="size-[18px]" />
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
