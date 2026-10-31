"use client";

import { t } from "@mellodifai/shared";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/browser";

export function LoginForm({ lang }: { lang: "it" | "en" }) {
  const [notice, setNotice] = useState("");
  async function submit(formData: FormData) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: String(formData.get("email")),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });
    setNotice(error ? t(lang, "auth.notAllowed") : t(lang, "auth.sent"));
  }
  return (
    <form action={submit} className="mt-6 space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="email">{t(lang, "auth.email")}</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <Button className="w-full" size="lg">
        {t(lang, "auth.sendLink")}
      </Button>
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
    </form>
  );
}
