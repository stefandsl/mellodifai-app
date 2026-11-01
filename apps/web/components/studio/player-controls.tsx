"use client";

import { cn } from "cn";
import { Download, Repeat, Repeat1 } from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { st } from "@/lib/studio/i18n";
import {
  downloadHref,
  downloadName,
  speedLabel,
} from "@/lib/studio/now-playing";
import { nextRepeat, SPEEDS, type Track, usePlayer } from "@/store/player";
import { IconButton, Tip } from "./ui";

// Off, all, one: one tap moves to the next state; the icon and the name say which is on.
export function RepeatButton({ className }: { className?: string }) {
  const lang = useLocale();
  const repeat = usePlayer((s) => s.repeat);
  const set = usePlayer((s) => s.set);
  return (
    <IconButton
      label={st(lang, `player.repeat.${repeat}`)}
      active={repeat !== "off"}
      onClick={() => set({ repeat: nextRepeat(repeat) })}
      className={className}
    >
      {repeat === "one" ? <Repeat1 /> : <Repeat />}
    </IconButton>
  );
}

// 0.5x to 2x; the choice is remembered between visits.
export function SpeedMenu({ className }: { className?: string }) {
  const lang = useLocale();
  const speed = usePlayer((s) => s.speed);
  const setSpeed = usePlayer((s) => s.setSpeed);
  return (
    <DropdownMenu>
      <Tip label={st(lang, "player.speed")}>
        <DropdownMenuTrigger
          aria-label={`${st(lang, "player.speed")}: ${speedLabel(speed)}`}
          className={cn(
            "inline-flex h-8 min-w-10 shrink-0 items-center justify-center rounded-full px-2 text-xs font-medium tabular-nums outline-none hover:bg-[var(--surface-glass-hover)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
            speed === 1
              ? "text-[var(--fg-muted)] hover:text-[var(--fg)]"
              : "text-[var(--brand)]",
            className,
          )}
        >
          {speedLabel(speed)}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-40 rounded-2xl p-1.5">
        <DropdownMenuRadioGroup
          value={String(speed)}
          onValueChange={(value) => setSpeed(Number(value))}
        >
          {SPEEDS.map((value) => (
            <DropdownMenuRadioItem
              key={value}
              value={String(value)}
              className="rounded-lg"
            >
              {value === 1 ? st(lang, "player.speedNormal") : speedLabel(value)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The audio the player is playing, saved under the song's title.
export function DownloadButton({
  track,
  className,
}: {
  track: Track;
  className?: string;
}) {
  const lang = useLocale();
  const name = downloadName(track.title, track.audioUrl);
  const label = st(lang, "player.download");
  return (
    <Tip label={label}>
      <a
        href={downloadHref(track.audioUrl, name)}
        download={name}
        aria-label={label}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none transition-colors hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] [&_svg]:size-4",
          className,
        )}
      >
        <Download />
      </a>
    </Tip>
  );
}
