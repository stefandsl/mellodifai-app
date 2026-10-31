"use client";
import {
  type LyricPack,
  type LyricPackTheme,
  t,
  validateLyricPack,
} from "@mellodifai/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { useLocale } from "./locale-provider";
import { useAction } from "./use-action";
export function LyricEditor({
  pack,
  theme,
  onApprove,
}: {
  pack: LyricPack;
  theme: LyricPackTheme;
  onApprove: (
    pack: LyricPack,
  ) => void | ActionResult | Promise<void> | Promise<ActionResult>;
}) {
  const lang = useLocale();
  const { pending, run } = useAction();
  const [value, setValue] = useState(pack);
  const [json, setJson] = useState({
    settings: JSON.stringify(pack.settings, null, 2),
    displayMap: JSON.stringify(pack.displayMap, null, 2),
    l10n: JSON.stringify(pack.l10n, null, 2),
  });
  let candidate: unknown = value;
  let jsonError = false;
  try {
    candidate = {
      ...value,
      settings: JSON.parse(json.settings),
      displayMap: JSON.parse(json.displayMap),
      l10n: JSON.parse(json.l10n),
    };
  } catch {
    jsonError = true;
  }
  const result = validateLyricPack(candidate, theme);
  return (
    <section className="space-y-4">
      {(["title", "lyrics", "style", "exclude"] as const).map((field) => (
        <label key={field} className="grid gap-2" htmlFor={`lyric-${field}`}>
          {t(
            lang,
            field === "title"
              ? "lyrics.title"
              : field === "lyrics"
                ? "lyrics.text"
                : field === "style"
                  ? "project.style"
                  : "lyrics.exclude",
          )}
          {field === "title" ? (
            <Input
              id={`lyric-${field}`}
              value={value[field]}
              onChange={(e) => setValue({ ...value, [field]: e.target.value })}
            />
          ) : (
            <Textarea
              id={`lyric-${field}`}
              rows={field === "lyrics" ? 16 : 3}
              value={value[field]}
              onChange={(e) => setValue({ ...value, [field]: e.target.value })}
            />
          )}
        </label>
      ))}
      {(["settings", "displayMap", "l10n"] as const).map((field) => (
        <label key={field} className="grid gap-2" htmlFor={`lyric-${field}`}>
          {t(lang, `lyrics.${field}`)}
          <Textarea
            id={`lyric-${field}`}
            value={json[field]}
            onChange={(e) => setJson({ ...json, [field]: e.target.value })}
          />
        </label>
      ))}
      {(!result.ok || jsonError) && (
        <div role="alert" className="text-destructive">
          {jsonError && <p>{t(lang, "validation.json")}</p>}
          {!result.ok &&
            result.errors.map((error) => (
              <p key={error}>
                {t(
                  lang,
                  error.includes("80 sung")
                    ? "validation.lines"
                    : error.includes("em dash")
                      ? "validation.dash"
                      : "validation.pack",
                )}
              </p>
            ))}
        </div>
      )}
      <Button
        disabled={pending || !result.ok || jsonError}
        onClick={() => run(() => onApprove(candidate as LyricPack))}
      >
        {t(lang, "action.approve")}
      </Button>
    </section>
  );
}
