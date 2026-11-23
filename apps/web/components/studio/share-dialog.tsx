"use client";

import { Copy, Mail, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { st, stf } from "@/lib/studio/i18n";
import { absoluteUrl, type ShareNetwork, shareLinks } from "@/lib/studio/share";

// A short monogram per network: no brand artwork, just a coloured tile with its initials.
const MONOGRAM: Record<Exclude<ShareNetwork, "email">, string> = {
  whatsapp: "WA",
  telegram: "TG",
  x: "X",
  facebook: "f",
  linkedin: "in",
  reddit: "r/",
};

// The share window of a song: copy the link, open a network's share page in a new tab, or hand
// the link to the device's own share sheet when it has one.
export function ShareDialog({
  open,
  onOpenChange,
  title,
  href,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  href: string;
}) {
  const lang = useLocale();
  const [copied, setCopied] = useState(false);
  // A dialog that unmounts before the "copied" mark resets must not update it.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const url = open ? absoluteUrl(href, window.location.origin) : "";
  const links = open ? shareLinks(url, title) : [];
  const canShare = open && typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(st(lang, "clip.copied"));
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(st(lang, "share.copyFailed"));
    }
  };
  const nativeShare = async () => {
    try {
      await navigator.share({ title, url });
    } catch (error) {
      // Closing the system sheet is not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.error(st(lang, "share.copyFailed"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setCopied(false);
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="gap-5 sm:max-w-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="text-lg">
              {st(lang, "share.title")}
            </DialogTitle>
            <DialogDescription className="mt-1 truncate">
              {stf(lang, "share.about", { title })}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label={st(lang, "share.close")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <X className="size-4" />
          </DialogClose>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="share-link"
            className="text-[13px] font-medium text-[var(--fg-muted)]"
          >
            {st(lang, "share.link")}
          </label>
          <div className="flex gap-2">
            <input
              id="share-link"
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-full bg-[var(--surface-glass)] px-3 text-[13px] ring-1 ring-[var(--hairline)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--fg)] px-4 text-[13px] font-medium text-[var(--bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <Copy className="size-3.5" />
              {copied ? st(lang, "det.copied") : st(lang, "share.copy")}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[13px] font-medium text-[var(--fg-muted)]">
            {st(lang, "share.networks")}
          </p>
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-4">
            {links.map((link) => (
              <li key={link.network}>
                <a
                  href={link.href}
                  {...(link.newTab
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  className="flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-[12px] text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  <span
                    aria-hidden
                    className="flex size-11 items-center justify-center rounded-full bg-[var(--surface-2)] text-[14px] font-semibold text-[var(--fg)]"
                  >
                    {link.network === "email" ? (
                      <Mail className="size-5" />
                    ) : (
                      MONOGRAM[link.network]
                    )}
                  </span>
                  {st(lang, `share.${link.network}`)}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {canShare ? (
          <button
            type="button"
            onClick={() => void nativeShare()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-[var(--surface-2)] text-[13px] font-medium outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <Share2 className="size-4" />
            {st(lang, "share.native")}
          </button>
        ) : null}

        <p className="text-[12px] leading-snug text-[var(--fg-subtle)]">
          {st(lang, "share.private")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
