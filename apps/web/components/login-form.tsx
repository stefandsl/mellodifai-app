"use client";
import { t } from "@mellodifai/shared";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/browser";
export function LoginForm({ lang }: { lang: "it" | "en" }) {
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="mt-6 space-y-4"
      action={(data) =>
        startTransition(async () => {
          try {
            await createClient().auth.signInWithOtp({
              email: String(data.get("email")),
              options: {
                shouldCreateUser: false,
                emailRedirectTo: `${window.location.origin}/auth/confirm`,
              },
            });
          } catch {
            // Keep transport failures indistinguishable from account refusal.
          } finally {
            setNotice(t(lang, "auth.sent"));
          }
        })
      }
    >
      <Label htmlFor="email">{t(lang, "auth.email")}</Label>
      <Input id="email" name="email" type="email" required />
      <Button type="submit" disabled={pending} className="w-full">
        {t(lang, "auth.sendLink")}
      </Button>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
