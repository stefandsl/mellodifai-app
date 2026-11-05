import { t } from "@mellodifai/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn() }));
vi.mock("@/app/actions/sign-in", () => ({
  sendSignInLink: mock.send,
  verifySignInCode: mock.verify,
}));

import { LoginForm } from "./login-form";

beforeEach(() => vi.clearAllMocks());
it("keeps a usable login form when the request cannot reach the server", async () => {
  mock.send.mockRejectedValue(new TypeError("Failed to fetch"));
  render(<LoginForm lang="it" next="/create" />);
  fireEvent.change(screen.getByLabelText("Indirizzo email"), {
    target: { value: "person@example.test" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Invia link di accesso" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      t("it", "auth.unavailable"),
    ),
  );
});
it.each(["it", "en"] as const)(
  "sends the email and next to the server and shows a neutral notice in %s",
  async (lang) => {
    mock.send.mockResolvedValue({ ok: true });
    render(<LoginForm lang={lang} next="/consent?uid=flow" />);
    fireEvent.change(screen.getByLabelText(t(lang, "auth.email")), {
      target: { value: "person@example.test" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: t(lang, "auth.sendLink") }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        t(lang, "auth.sent"),
      ),
    );
    expect(mock.send).toHaveBeenCalledWith(
      "person@example.test",
      "/consent?uid=flow",
    );
  },
);

it("submits a code without requesting another email and displays verification errors", async () => {
  mock.verify.mockResolvedValue({
    ok: false,
    code: "unauthorized",
    error: "Codice non valido",
  });
  render(<LoginForm lang="it" next="/library" />);
  fireEvent.change(screen.getByLabelText("Indirizzo email"), {
    target: { value: "person@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Codice a 6 cifre"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Accedi con il codice" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Codice non valido"),
  );
  expect(mock.verify).toHaveBeenCalledWith(
    "person@example.test",
    "123456",
    "/library",
  );
  expect(mock.send).not.toHaveBeenCalled();
});

it("shows server rate limits without exposing provider errors", async () => {
  mock.send.mockResolvedValue({
    ok: false,
    code: "rate_limited",
    error: "Troppi tentativi. Riprova tra poco.",
  });
  render(<LoginForm lang="it" next="/create" />);
  fireEvent.change(screen.getByLabelText("Indirizzo email"), {
    target: { value: "person@example.test" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Invia link di accesso" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Troppi tentativi. Riprova tra poco.",
    ),
  );
});
