import { PUBLISHING_OFF_MESSAGE } from "@/lib/publishing-off";

// Shown instead of the Pubblica pages while MDF_PUBLISHING=off (lib/publishing-off.ts).
export function PublishingOffNotice() {
  return (
    <p
      role="status"
      className="max-w-2xl rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed"
    >
      {PUBLISHING_OFF_MESSAGE}
    </p>
  );
}
