import { Suspense } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailsPanel } from "./details-panel";
import { PlayerBar } from "./player-bar";
import { PlaylistsProvider, type PlaylistsState } from "./playlists-context";
import { MobileTopBar, StudioSidebar } from "./sidebar";
import { VideoStudio } from "./video/video-studio";
import { VisualizerWatcher } from "./video/visualizer-watcher";
import { type WorkerInfo, WorkerProvider } from "./worker-state";

// Sidebar | page, with the player bar fixed along the bottom (brief section 1.1).
export function StudioShell({
  email,
  worker,
  isAdmin,
  playlists,
  children,
}: {
  email: string;
  worker: WorkerInfo;
  isAdmin: boolean;
  playlists: PlaylistsState;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delay={300}>
      <WorkerProvider initial={worker} isAdmin={isAdmin}>
        <PlaylistsProvider value={playlists}>
          <div className="flex h-dvh flex-col overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
            <div className="flex min-h-0 flex-1">
              <Suspense>
                <StudioSidebar email={email} />
              </Suspense>
              <div className="flex min-w-0 flex-1 flex-col">
                <Suspense>
                  <MobileTopBar />
                </Suspense>
                <main className="min-h-0 flex-1">{children}</main>
              </div>
              <DetailsPanel />
            </div>
            <PlayerBar />
          </div>
          <VideoStudio />
          <VisualizerWatcher />
        </PlaylistsProvider>
      </WorkerProvider>
    </TooltipProvider>
  );
}

// Plain scrolling page inside the shell, for screens without the create panel.
export function StudioPage({
  title,
  eyebrow,
  children,
  actions,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            {eyebrow ? (
              <p className="text-[13px] text-[var(--fg-muted)]">{eyebrow}</p>
            ) : null}
            <h1 className="mt-1 text-3xl font-medium tracking-tight sm:text-[40px]">
              {title}
            </h1>
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}
