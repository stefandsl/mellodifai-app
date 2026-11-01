import { cn } from "cn";
import { Film, Loader2 } from "lucide-react";

import { type Clip, isGenerating } from "@/lib/studio/clips";

// What sits on a song's cover (the cover itself is the parent's `background`): a frame of the
// song's video when there is no image, the title on the generated artwork when there is
// neither, the language tag and a film mark. A spinner while the song is being made.
export function CoverFace({
  clip,
  size,
}: {
  clip: Clip;
  size: "mini" | "list" | "grid" | "panel";
}) {
  const generating = isGenerating(clip.status);
  return (
    <>
      {!generating && !clip.hasCover && clip.videoUrl ? (
        // No thumbnail yet: a frame from the song's own video stands in as the cover.
        <video
          aria-hidden
          src={`${clip.videoUrl}#t=25`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
      ) : null}
      {size !== "mini" && !generating && !clip.hasCover && !clip.videoUrl ? (
        // No image at all yet: the title on the song's own artwork is its cover.
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-2 top-2 line-clamp-3 font-semibold leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]",
            size === "list" ? "text-[11px]" : "text-lg",
            size === "panel" && "inset-x-4 top-4 text-2xl",
          )}
        >
          {clip.title}
        </span>
      ) : null}
      {generating ? (
        <Loader2
          className={cn(
            "absolute top-1/2 left-1/2 -translate-1/2 animate-spin text-[var(--fg-muted)]",
            size === "mini" ? "size-4" : "size-5",
          )}
        />
      ) : size === "panel" || size === "mini" ? null : (
        <span
          aria-hidden
          className="absolute bottom-1.5 left-2 font-mono text-[11px] font-semibold text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]"
        >
          {clip.lang.toUpperCase()}
        </span>
      )}
      {size !== "mini" && clip.videoUrl ? (
        <Film
          aria-hidden
          className="absolute top-1.5 right-1.5 size-3.5 text-white/85"
        />
      ) : null}
    </>
  );
}
