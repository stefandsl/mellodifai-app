"use client";

import { LANGS, t } from "@mellodifai/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProject } from "@/app/actions/project";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "./locale-provider";
import { useAction } from "./use-action";

export function ProjectForm({ balance }: { balance: number | null }) {
  const router = useRouter();
  const lang = useLocale();
  const { pending, run } = useAction();
  const [languages, setLanguages] = useState<string[]>(["it"]);

  function submit(formData: FormData) {
    run(async () => {
      const result = await createProject({
        topic: String(formData.get("topic")),
        brief: String(formData.get("brief")),
        languages,
        style: String(formData.get("style")),
        mood: String(formData.get("mood")),
        vocalGender: String(formData.get("vocalGender")),
      });
      if (result.ok) router.push(`/projects/${result.id}`);
      return result;
    });
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(new FormData(event.currentTarget));
      }}
      className="space-y-6"
    >
      <div className="grid gap-2">
        <Label htmlFor="topic">{t(lang, "project.topic")}</Label>
        <Input id="topic" name="topic" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="brief">{t(lang, "project.brief")}</Label>
        <Textarea id="brief" name="brief" />
      </div>
      <div className="grid gap-2">
        <Label>{t(lang, "project.languages")}</Label>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {LANGS.map((language) => (
            <Label className="flex items-center gap-2" key={language}>
              <Checkbox
                checked={languages.includes(language)}
                onCheckedChange={(checked) =>
                  setLanguages((old) =>
                    checked
                      ? [...old, language]
                      : old.filter((item) => item !== language),
                  )
                }
              />
              {language.toUpperCase()}
            </Label>
          ))}
        </div>
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="style">{t(lang, "project.style")}</Label>
          <Input id="style" name="style" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="mood">{t(lang, "project.mood")}</Label>
          <Input id="mood" name="mood" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="vocalGender">{t(lang, "project.vocalGender")}</Label>
          <Select name="vocalGender" defaultValue="f">
            <SelectTrigger id="vocalGender">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="f">{t(lang, "voice.f")}</SelectItem>
              <SelectItem value="m">{t(lang, "voice.m")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <aside className="rounded-xl border border-[#2BD9A0]/50 bg-[#2BD9A0]/10 p-4 text-sm">
        <p>{t(lang, "project.credits")}</p>
        <p className="mt-1 text-muted-foreground">
          {t(lang, "project.balance")}: {balance ?? "-"}
        </p>
        <p className="mt-1 text-muted-foreground">{t(lang, "project.theme")}</p>
      </aside>
      <Button
        type="submit"
        size="lg"
        disabled={pending || languages.length === 0}
      >
        {t(lang, "project.create")}
      </Button>
    </form>
  );
}
