"use client";
import { type DictKey, t } from "@mellodifai/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/browser";

export function loginNotice(error: unknown, rejected = false): DictKey {
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

export const passwordNotice = (): DictKey => "auth.invalidCredentials";

export function LoginForm({ lang }: { lang: "it" | "en" }) {
  const [notice, setNotice] = useState("");
  const [magicLink, setMagicLink] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={() => setNotice("")}
      action={() => {
        setNotice("");
        startTransition(async () => {
          try {
            if (magicLink) {
              const { error } = await createClient().auth.signInWithOtp({
                email,
                options: {
                  shouldCreateUser: false,
                  emailRedirectTo: `${window.location.origin}/auth/confirm`,
                },
              });
              setNotice(t(lang, loginNotice(error)));
              return;
            }
            const { error } = await createClient().auth.signInWithPassword({
              email,
              password,
            });
            if (error) {
              setPassword("");
              setNotice(t(lang, passwordNotice()));
              return;
            }
            router.replace("/");
            router.refresh();
          } catch (error) {
            if (!magicLink) setPassword("");
            setNotice(
              t(lang, magicLink ? loginNotice(error, true) : passwordNotice()),
            );
          }
        });
      }}
    >
      <Label htmlFor="email">{t(lang, "auth.email")}</Label>
      <Input
        id="email"
        name="email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {!magicLink && (
        <>
          <Label htmlFor="password">{t(lang, "auth.password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {t(lang, magicLink ? "auth.sendLink" : "auth.signIn")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => {
          setMagicLink((value) => !value);
          setNotice("");
        }}
      >
        {t(lang, magicLink ? "auth.signIn" : "auth.magicLink")}
      </Button>
      {!magicLink && (
        <p className="text-sm text-muted-foreground">
          {t(lang, "auth.forgotPassword")} {t(lang, "auth.forgotPasswordHint")}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
