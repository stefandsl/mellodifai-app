import { cn } from "cn";
import { Heart } from "lucide-react";

import { artFor } from "@/lib/studio/cover-art";

// The tile of a playlist: its own procedural cover, sized by the caller.
export function PlaylistArt({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("block shrink-0 overflow-hidden", className)}
      style={{ background: artFor(id) }}
    />
  );
}

// The heart tile of the "Mi piace" system playlist.
export function LikedTile({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-cta flex shrink-0 items-center justify-center text-white",
        className,
      )}
    >
      <Heart className="size-1/2 fill-current" />
    </span>
  );
}
