"use client";

import type { LyricPack, LyricPackTheme } from "@mellodifai/shared";
import { t, validateLyricPack } from "@mellodifai/shared";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function LyricEditor({
  pack,
  theme,
  onApprove,
}: {
  pack: LyricPack;
  theme: LyricPackTheme;
  onApprove: (pack: LyricPack) => void | Promise<void>;
}) {
  const [value, setValue] = useState(pack);
  const result = useMemo(() => validateLyricPack(value, theme), [value, theme]);
  const errors = result.ok ? [] : result.errors;
  return (
    <section className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="lyric-title">{t("it", "lyrics.title")}</Label>
        <Input
          id="lyric-title"
          value={value.title}
          onChange={(event) =>
            setValue({ ...value, title: event.target.value })
          }
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="lyric-text">{t("it", "lyrics.text")}</Label>
        <Textarea
          id="lyric-text"
          rows={16}
          value={value.lyrics}
          onChange={(event) =>
            setValue({ ...value, lyrics: event.target.value })
          }
        />
      </div>
      {errors.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <Button disabled={!result.ok} onClick={() => onApprove(value)}>
        {t("it", "action.approve")}
      </Button>
    </section>
  );
}
