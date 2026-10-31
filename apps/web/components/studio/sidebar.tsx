"use client";

import { cn } from "cn";
import {
  CircleDollarSign,
  Film,
  Languages,
  Library,
  LogOut,
  Moon,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useLocale } from "@/components/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { st } from "@/lib/studio/i18n";
import { createClient } from "@/lib/supabase/browser";
import { workerIsOnline } from "@/lib/worker";
import { Tip } from "./ui";

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--brand)] text-white shadow-[0_6px_20px_-8px_var(--brand)]"
      >
        <Music2 className="size-4" strokeWidth={2.5} />
      </span>
      {compact ? null : (
        <span className="text-[17px] font-semibold tracking-tight">
          mellodifai<span className="text-[var(--brand)]">.</span>
        </span>
      )}
    </span>
  );
}

export type WorkerInfo = {
  id: string | null;
  lastSeen: string | null;
  balance: number | null;
};

export function useWorker(initial: WorkerInfo) {
  const [worker, setWorker] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const db = createClient();
    let cancelled = false;
    const refresh = async () => {
      setNow(Date.now());
      const { data } = await db
        .from("workers")
        .select("id,last_seen,kie_balance")
        .order("last_seen", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && !cancelled)
        setWorker({
          id: data.id,
          lastSeen: data.last_seen,
          balance: data.kie_balance,
        });
    };
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return { ...worker, online: workerIsOnline(worker.lastSeen, now) };
}

const NAV = [
  { href: "/create", key: "nav.create", icon: Music2 },
  { href: "/library", key: "nav.library", icon: Library },
  { href: "/library?tab=videos", key: "nav.videos", icon: Film },
  { href: "/credits", key: "nav.credits", icon: CircleDollarSign },
  { href: "/settings", key: "nav.settings", icon: Settings },
] as const;

function isActive(href: string, pathname: string, tab: string | null) {
  const [path, query] = href.split("?");
  if (pathname !== path) return false;
  return query ? query === `tab=${tab}` : !tab || path !== "/library";
}

export function StudioSidebar({
  email,
  worker: initialWorker,
}: {
  email: string;
  worker: WorkerInfo;
}) {
  const lang = useLocale();
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const worker = useWorker(initialWorker);
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
        "group/sidebar hidden h-full shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--bg)] px-3 pt-4 pb-3 min-[900px]:flex",
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

      <nav aria-label="Main" className="flex flex-col gap-0.5">
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
        {wrap(
          st(lang, dark ? "theme.light" : "theme.dark"),
          <button
            type="button"
            onClick={() => setTheme(dark ? "light" : "dark")}
            className={cn(
              row,
              "text-[var(--fg-muted)] hover:bg-[var(--surface-glass)] hover:text-[var(--fg)]",
            )}
          >
            {dark ? <Sun /> : <Moon />}
            <span className={cn("hidden xl:inline", collapsed && "xl:hidden")}>
              {st(lang, dark ? "theme.light" : "theme.dark")}
            </span>
          </button>,
        )}
        {wrap(
          st(lang, "lang.switch"),
          <button
            type="button"
            onClick={() => {
              // biome-ignore lint/suspicious/noDocumentCookie: locale persistence needs a browser cookie.
              document.cookie = `mellodifai_lang=${lang === "it" ? "en" : "it"}; path=/; max-age=31536000`;
              router.refresh();
            }}
            className={cn(
              row,
              "text-[var(--fg-muted)] hover:bg-[var(--surface-glass)] hover:text-[var(--fg)]",
            )}
          >
            <Languages />
            <span className={cn("hidden xl:inline", collapsed && "xl:hidden")}>
              {st(lang, "lang.switch")}
            </span>
          </button>,
        )}
        <div className="my-2 h-px bg-[var(--hairline)]" />
        {wrap(
          `${st(lang, "nav.signOut")} (${email})`,
          <button
            type="button"
            onClick={async () => {
              await createClient().auth.signOut();
              router.push("/login");
              router.refresh();
            }}
            className={cn(
              row,
              "text-[var(--fg-muted)] hover:bg-[var(--surface-glass)] hover:text-[var(--fg)]",
            )}
          >
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[10px] font-semibold text-[var(--fg)] uppercase"
            >
              {email.charAt(0)}
            </span>
            <span
              className={cn(
                "hidden min-w-0 flex-1 truncate text-left text-xs xl:block",
                collapsed && "xl:hidden",
              )}
            >
              {email}
            </span>
            <LogOut
              className={cn(
                "hidden size-4! xl:block",
                collapsed && "xl:hidden",
              )}
            />
          </button>,
        )}
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
        <Logo />
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1">
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
