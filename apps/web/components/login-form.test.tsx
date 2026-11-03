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
const signInWithPassword = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { signInWithOtp: signIn, signInWithPassword } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { LoginForm } from "./login-form";

it.each(["it", "en"] as const)(
  "shows a neutral delivery notice or a real service error in %s",
  async (lang) => {
    const outage =
      lang === "it"
        ? "Servizio temporaneamente non disponibile. Riprova tra poco."
        : "Service temporarily unavailable. Please try again shortly.";
    const limited =
      lang === "it"
        ? "Troppi tentativi, riprova tra qualche minuto"
        : "Too many attempts, please try again in a few minutes";
    for (const [error, expected, rejected] of [
      [null, t(lang, "auth.sent"), false],
      [{ code: "otp_disabled" }, t(lang, "auth.sent"), false],
      [{ code: "signup_disabled" }, t(lang, "auth.sent"), false],
      [
        { status: 422, message: "Signups not allowed for otp" },
        t(lang, "auth.sent"),
        false,
      ],
      [{ status: 403, message: "not allowed" }, t(lang, "auth.sent"), false],
      [
        { status: 400, message: "Account refused" },
        t(lang, "auth.sent"),
        false,
      ],
      [{ status: 429 }, limited, false],
      [{ status: 500 }, outage, false],
      [{ status: 503 }, outage, false],
      [{ name: "AuthRetryableFetchError", status: 0 }, outage, false],
      [new TypeError("Failed to fetch"), outage, true],
      [new Error("Network request failed"), outage, true],
      [{ status: 0 }, outage, false],
      [{ code: "signup_disabled" }, t(lang, "auth.sent"), true],
    ] as const) {
      signIn.mockReset();
      if (rejected) signIn.mockRejectedValue(error);
      else signIn.mockResolvedValue({ error });
      render(<LoginForm lang={lang} />);
      fireEvent.change(screen.getByLabelText(t(lang, "auth.email")), {
        target: { value: "person@example.com" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: t(lang, "auth.magicLink") }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: t(lang, "auth.sendLink") }),
      );
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(expected),
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

it("maps every password failure to the neutral notice", async () => {
  signInWithPassword.mockResolvedValue({
    error: { status: 400, message: "User not found" },
  });
  render(<LoginForm lang="it" />);
  fireEvent.change(screen.getByLabelText(t("it", "auth.email")), {
    target: { value: "person@example.com" },
  });
  fireEvent.change(screen.getByLabelText(t("it", "auth.password")), {
    target: { value: "wrong-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: t("it", "auth.signIn") }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Email o password non validi",
    ),
  );
  cleanup();
});

it("keeps the email for a second password attempt and clears the notice", async () => {
  signInWithPassword.mockResolvedValue({ error: { status: 400 } });
  render(<LoginForm lang="it" />);
  const email = screen.getByLabelText(t("it", "auth.email"));
  const password = screen.getByLabelText(t("it", "auth.password"));
  const submit = screen.getByRole("button", { name: t("it", "auth.signIn") });
  fireEvent.change(email, { target: { value: "person@example.com" } });
  fireEvent.change(password, { target: { value: "wrong-password" } });
  fireEvent.click(submit);
  await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  expect(email).toHaveValue("person@example.com");
  expect(password).toHaveValue("");

  signInWithPassword.mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.change(password, { target: { value: "another-password" } });
  fireEvent.click(submit);
  await waitFor(() =>
    expect(screen.queryByRole("status")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(2));
  expect(signInWithPassword).toHaveBeenLastCalledWith({
    email: "person@example.com",
    password: "another-password",
  });
  cleanup();
});
