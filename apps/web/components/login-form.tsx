"use client";
import { t } from "@mellodifai/shared";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/browser";

function loginNotice(error: unknown, rejected = false) {
  if (!error) return "auth.sent";
  const details = error as { status?: number; code?: string; name?: string };
  if (details.status === 429) return "auth.rateLimited";
  if (details.status !== undefined && details.status >= 500)
    return "auth.unavailable";
  // Account refusals must be indistinguishable from a successful delivery.
  if (details.code === "otp_disabled" || details.code === "signup_disabled")
    return "auth.sent";
  if (details.status !== undefined && details.status >= 400) return "auth.sent";
  if (
    error instanceof TypeError ||
    details.name === "AuthRetryableFetchError" ||
    details.status === 0
  )
    return "auth.unavailable";
  return rejected ? "auth.unavailable" : "auth.sent";
}

export function LoginForm({ lang }: { lang: "it" | "en" }) {
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="mt-6 space-y-4"
      action={(data) =>
        startTransition(async () => {
          try {
            const { error } = await createClient().auth.signInWithOtp({
              email: String(data.get("email")),
              options: {
                shouldCreateUser: false,
                emailRedirectTo: `${window.location.origin}/auth/confirm`,
              },
            });
            setNotice(t(lang, loginNotice(error)));
          } catch (error) {
            setNotice(t(lang, loginNotice(error, true)));
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
