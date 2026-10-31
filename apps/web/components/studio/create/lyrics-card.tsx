"use client";

import { cn } from "cn";
import { Expand, FilePlus2, Minimize2, Redo2, Undo2 } from "lucide-react";
import { Fragment, useRef, useState } from "react";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { LIMITS, useCreateForm } from "@/store/create-form";
import { Counter, IconButton, PanelCard } from "../ui";

const TAGS = [
  "Intro",
  "Verse 1",
  "Verse 2",
  "Pre-Chorus",
  "Chorus",
  "Bridge",
  "Final Chorus",
  "Outro",
] as const;
const TAG_LINE = /^\s*\[[^\]\n]*\]\s*$/u;

// Same text as the textarea, with section tags muted (the textarea on top has transparent text).
function Highlight({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional.
        <Fragment key={i}>
          {TAG_LINE.test(line) ? (
            <span className="text-[var(--fg-subtle)]">{line}</span>
          ) : (
            line
          )}
          {i < lines.length - 1 ? "\n" : null}
        </Fragment>
      ))}
      {"\n"}
    </>
  );
}

export function LyricsCard() {
  const lang = useLocale();
  const lyrics = useCreateForm((s) => s.lyrics);
  const open = useCreateForm((s) => s.open.lyrics);
  const set = useCreateForm((s) => s.set);
  const toggle = useCreateForm((s) => s.toggleCard);
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [tagAt, setTagAt] = useState<number | null>(null);
  const it = lang === "it";

  function caretCheck(target: HTMLTextAreaElement) {
    const at = target.selectionStart;
    const lineStart = target.value.lastIndexOf("\n", at - 1) + 1;
    const before = target.value.slice(lineStart, at);
    setTagAt(/^\s*\[[^\]]*$/u.test(before) ? lineStart : null);
  }
  function insertTag(tag: string) {
    const el = area.current;
    if (!el || tagAt === null) return;
    const lineEnd = el.value.indexOf("\n", el.selectionStart);
    const end = lineEnd === -1 ? el.value.length : lineEnd + 1;
    const next = `${el.value.slice(0, tagAt)}[${tag}]\n${el.value.slice(end)}`;
    set({ lyrics: next });
    setTagAt(null);
    const caret = tagAt + tag.length + 3;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }
  function history(command: "undo" | "redo") {
    area.current?.focus();
    // Native history keeps working on a controlled textarea while edits come from the user.
    document.execCommand(command);
  }

  return (
    <div
      className={cn(
        full &&
          "fixed inset-0 z-50 flex flex-col bg-[color-mix(in_oklab,var(--bg),transparent_6%)] p-4 backdrop-blur-sm sm:p-10",
      )}
    >
      <PanelCard
        id="lyrics"
        title={st(lang, "create.lyrics")}
        open={open || full}
        onToggle={() => (full ? setFull(false) : toggle("lyrics"))}
        actions={
          <>
            <IconButton
              label={it ? "Annulla" : "Undo"}
              onClick={() => history("undo")}
              className="bg-transparent"
            >
              <Undo2 />
            </IconButton>
            <IconButton
              label={it ? "Ripeti" : "Redo"}
              onClick={() => history("redo")}
              className="bg-transparent"
            >
              <Redo2 />
            </IconButton>
            <IconButton
              label={it ? "Nuova bozza" : "New draft"}
              className="bg-transparent"
              onClick={() => {
                if (
                  !lyrics ||
                  window.confirm(
                    it ? "Cancellare il testo?" : "Discard these lyrics?",
                  )
                )
                  set({ lyrics: "" });
              }}
            >
              <FilePlus2 />
            </IconButton>
            <IconButton
              label={
                full
                  ? it
                    ? "Esci dallo schermo intero"
                    : "Exit full screen"
                  : it
                    ? "Editor a schermo intero"
                    : "Open full-screen editor"
              }
              className="bg-transparent"
              onClick={() => setFull(!full)}
            >
              {full ? <Minimize2 /> : <Expand />}
            </IconButton>
          </>
        }
      >
        <div className="relative">
          <div
            ref={mirror}
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 overflow-hidden px-0.5 leading-6 break-words whitespace-pre-wrap text-[var(--fg)]",
              full ? "h-[calc(100dvh-15rem)]" : "h-56",
            )}
          >
            <Highlight text={lyrics} />
          </div>
          <textarea
            ref={area}
            value={lyrics}
            aria-label={st(lang, "create.lyrics")}
            placeholder={st(lang, "create.lyricsPlaceholder")}
            spellCheck={false}
            onChange={(event) => {
              set({ lyrics: event.target.value });
              caretCheck(event.target);
            }}
            onKeyUp={(event) => caretCheck(event.currentTarget)}
            onClick={(event) => caretCheck(event.currentTarget)}
            onBlur={() => setTagAt(null)}
            onScroll={(event) => {
              if (mirror.current)
                mirror.current.scrollTop = event.currentTarget.scrollTop;
            }}
            className={cn(
              "relative block w-full resize-none bg-transparent px-0.5 leading-6 break-words whitespace-pre-wrap text-transparent caret-[var(--fg)] outline-none scrollbar-thin placeholder:text-[var(--fg-subtle)] selection:bg-[color-mix(in_oklab,var(--brand),transparent_55%)]",
              full ? "h-[calc(100dvh-15rem)]" : "h-56",
            )}
          />
          {tagAt !== null ? (
            <div
              role="listbox"
              aria-label={it ? "Sezioni" : "Sections"}
              className="absolute bottom-10 left-0 z-10 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[var(--surface-2)] p-1 shadow-lg scrollbar-none"
            >
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertTag(tag)}
                  className="rounded-lg px-2 py-1 text-xs whitespace-nowrap text-[var(--fg-muted)] hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)]"
                >
                  [{tag}]
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex h-7 items-center justify-between gap-2">
            <span className="text-xs text-[var(--fg-subtle)]">
              {lyrics.trim() ? "" : st(lang, "create.aiLyrics")}
            </span>
            <Counter value={lyrics.length} max={LIMITS.lyrics} />
          </div>
        </div>
      </PanelCard>
    </div>
  );
}
