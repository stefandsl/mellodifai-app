"use client";
import { t } from "@mellodifai/shared";
import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import { sendSignInLink, verifySignInCode } from "@/app/actions/sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ lang, next }: { lang: "it" | "en"; next: string }) {
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="mt-6 space-y-4"
      action={() =>
        startTransition(async () => {
          try {
            const result = await sendSignInLink(email, next);
            setNotice(result.ok ? t(lang, "auth.sent") : result.error);
          } catch (error) {
            unstable_rethrow(error);
            setNotice(t(lang, "auth.unavailable"));
          }
        })
      }
    >
      <Label htmlFor="email">{t(lang, "auth.email")}</Label>
      <Input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button type="submit" disabled={pending} className="w-full">
        {t(lang, "auth.sendLink")}
      </Button>
      <Label htmlFor="code">{t(lang, "auth.code")}</Label>
      <Input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <Button
        type="submit"
        disabled={pending || !/^\d{6}$/u.test(code)}
        className="w-full"
        formAction={() =>
          startTransition(async () => {
            try {
              const result = await verifySignInCode(email, code, next);
              if (!result.ok) setNotice(result.error);
            } catch (error) {
              unstable_rethrow(error);
              setNotice(t(lang, "auth.unavailable"));
            }
          })
        }
      >
        {t(lang, "auth.verifyCode")}
      </Button>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
