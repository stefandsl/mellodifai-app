import { t } from "@mellodifai/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";

const signIn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { signInWithOtp: signIn } }),
}));

import { LoginForm } from "./login-form";

it.each(["it", "en"] as const)(
  "keeps accepted, refused and transport-failed login messages identical in %s",
  async (lang) => {
    for (const outcome of ["accepted", "refused", "transport"]) {
      signIn.mockReset();
      if (outcome === "transport")
        signIn.mockRejectedValue(new Error("offline"));
      else
        signIn.mockResolvedValue({
          error: outcome === "refused" ? { message: "not allowed" } : null,
        });
      render(<LoginForm lang={lang} />);
      fireEvent.change(screen.getByLabelText(t(lang, "auth.email")), {
        target: { value: "person@example.com" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: t(lang, "auth.sendLink") }),
      );
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          t(lang, "auth.sent"),
        ),
      );
      expect(signIn).toHaveBeenCalledWith({
        email: "person@example.com",
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });
      cleanup();
    }
  },
);
