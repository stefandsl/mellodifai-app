"use server";

import { t } from "@mellodifai/shared";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { getLocale } from "@/lib/locale";
import { rateLimit } from "@/lib/rate-limit";
import {
  emailRedirect,
  requestOrigin,
  safeNext,
  signInEnvironment,
} from "@/lib/redirect-url";
import { isRemote } from "@/lib/remote";
import { remoteAction } from "@/lib/run-action";
import { createClient } from "@/lib/supabase/server";

const input = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  next: z.string().max(2048),
});

export async function sendSignInLink(
  email: string,
  next: string,
): Promise<ActionResult> {
  return remoteAction(
    {
      unauthenticated: true,
      input,
      rateLimit: ({ email }) => rateLimit(email, "signIn").ok,
      async run({ email, next }) {
        let emailRedirectTo: string;
        try {
          const requestHeaders = await headers();
          const env = signInEnvironment();
          emailRedirectTo = emailRedirect(
            requestHeaders.get("origin") ??
              requestOrigin(requestHeaders, env.siteUrl),
            env,
            isRemote(requestHeaders),
            next,
          );
        } catch {
          return {
            ok: false,
            code: "validation",
            error: t(await getLocale(), "error.validation"),
          };
        }
        try {
          const db = await createClient();
          await db.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false, emailRedirectTo },
          });
        } catch {
          // Delivery, account refusals and upstream quotas must not reveal membership.
        }
        return { ok: true };
      },
    },
    { email, next },
  );
}

export async function verifySignInCode(
  email: string,
  code: string,
  next: string,
): Promise<ActionResult> {
  return remoteAction(
    {
      unauthenticated: true,
      input: input.extend({ code: z.string().regex(/^\d{6}$/u) }),
      rateLimit: ({ email }) => rateLimit(email, "signInCode").ok,
      async run({ email, code, next }) {
        let destination: string;
        try {
          const requestHeaders = await headers();
          destination = safeNext(next, isRemote(requestHeaders));
          const db = await createClient();
          const { error } = await db.auth.verifyOtp({
            email,
            token: code,
            type: "email",
          });
          if (error)
            return {
              ok: false,
              code: "unauthorized",
              error: t(await getLocale(), "auth.invalidCode"),
            };
        } catch {
          return {
            ok: false,
            code: "internal",
            error: t(await getLocale(), "auth.unavailable"),
          };
        }
        redirect(destination);
      },
    },
    { email, code, next },
  );
}
