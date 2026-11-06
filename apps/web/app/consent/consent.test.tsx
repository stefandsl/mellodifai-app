import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Headers(),
  claims: vi.fn(),
  call: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: (name: string) =>
      mock.cookies.has(name) ? [{ name, value: mock.cookies.get(name) }] : [],
  }),
  headers: async () => mock.headers,
}));
vi.mock("next/navigation", () => ({ redirect: mock.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getActionClaims: mock.claims }));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "it" }));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mock.call }));

import { consentDecide } from "./actions";
import ConsentPage from "./page";

const nonce = "n".repeat(43);
const info = {
  client_name: "Agente musicale",
  client_id: "client-1",
  redirect_host: "connector.example.test",
  registered_at: "2026-11-06T10:00:00Z",
  requested_scopes: ["read", "create", "spend"],
};
const page = (uid: string | string[] | undefined = "flow-1") =>
  ConsentPage({ searchParams: Promise.resolve({ uid }) });
const mutations = () =>
  mock.call.mock.calls.filter(([fn]) => fn === "oauth_consent");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SITE_URL", "http://127.0.0.1:3210");
  mock.cookies = new Map([["mdf_flow", nonce]]);
  mock.headers = new Headers();
  mock.claims.mockResolvedValue({ sub: "owner", session_id: "session" });
  mock.redirect.mockImplementation((url) => {
    throw new Error(`redirect:${url}`);
  });
  mock.call.mockImplementation(async (fn) =>
    fn === "oauth_consent_info"
      ? { ok: true, data: info }
      : {
          ok: true,
          data: { token_id: "00000000-0000-4000-8000-000000000001" },
        },
  );
});
afterEach(() => vi.unstubAllEnvs());

it("without the flow cookie the page says to start again from the agent in this browser", async () => {
  mock.cookies.clear();
  render(await page());
  // Start the connection again from your agent in this browser.
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Avvia di nuovo il collegamento dal tuo agente in questo browser.",
  );
  expect(
    screen.queryByRole("button", { name: "Autorizza" }),
  ).not.toBeInTheDocument();
  expect(mock.call).not.toHaveBeenCalled();
});

it("only read is ticked by default", async () => {
  render(await page());
  // Read, create, spend, and fake-provider test mode.
  expect(screen.getByRole("checkbox", { name: "Leggere" })).toBeChecked();
  for (const name of ["Creare", "Spendere", "Test (provider simulati)"])
    expect(screen.getByRole("checkbox", { name })).not.toBeChecked();
  expect(screen.getByText(info.client_name)).toBeVisible();
  expect(screen.getByText(info.redirect_host)).toBeVisible();
  expect(document.querySelector("time")).toHaveAttribute(
    "dateTime",
    info.registered_at,
  );
  expect(mock.call).toHaveBeenCalledWith("oauth_consent_info", [
    expect.objectContaining({
      actor_kind: "session",
      user_id: "owner",
      remote: false,
    }),
    "flow-1",
    nonce,
  ]);
});

it("spend needs the typed client name", async () => {
  for (const confirmation of [undefined, "wrong", "Agente musicale "])
    expect(
      await consentDecide("flow-1", ["read", "spend"], false, confirmation),
    ).toMatchObject({ ok: false, code: "validation" });
  expect(mutations()).toHaveLength(0);
  expect(
    await consentDecide("flow-1", ["read", "spend"], true, info.client_name),
  ).toEqual({ ok: true });
  expect(mutations()[0][1]).toEqual([
    expect.objectContaining({ actor_kind: "session", user_id: "owner" }),
    "flow-1",
    nonce,
    ["read", "spend"],
    true,
  ]);
});

it("asks for the client name only when spend is selected", async () => {
  const user = userEvent.setup();
  render(await page());
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Spendere" }));
  expect(screen.getByRole("button", { name: "Autorizza" })).toBeDisabled();
  // Type the client name to confirm spending permission.
  await user.type(
    screen.getByLabelText("Nome del client per confermare la spesa"),
    info.client_name,
  );
  expect(screen.getByRole("button", { name: "Autorizza" })).toBeEnabled();
});

it("consent page escapes the client name", async () => {
  const name = `${"🎵".repeat(50)}<img src=x onerror=alert(1)>`;
  mock.call.mockResolvedValue({
    ok: true,
    data: { ...info, client_name: [...name].slice(0, 60).join("") },
  });
  const markup = renderToStaticMarkup(await page());
  expect(markup).toContain("&lt;img");
  expect(markup).not.toContain("<img");
  render(await page());
  expect(screen.getByText([...name].slice(0, 60).join(""))).toBeVisible();
});

it("a loopback-only client is refused remotely (Major 27)", async () => {
  mock.headers.set("x-mdf-remote", "1");
  mock.call.mockImplementation(async (fn) =>
    fn === "oauth_consent_info"
      ? { ok: true, data: { ...info, redirect_host: "127.0.0.1" } }
      : {
          ok: false,
          code: "forbidden_scope",
          message: "remote access refused",
        },
  );
  render(await page());
  const form = screen
    .getByRole("button", { name: "Autorizza" })
    .closest("form");
  if (!form) throw new Error("Consent form missing");
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
  expect(mutations()[0][1][0]).toMatchObject({ remote: true });
  expect(await consentDecide("flow-1", ["read"], false)).toMatchObject({
    ok: false,
    code: "forbidden_scope",
  });
});

it("redirects an unsigned browser to login with the consent destination", async () => {
  mock.claims.mockRejectedValue(new Error("Unauthorized"));
  await expect(page()).rejects.toThrow(
    "redirect:/login?next=%2Fconsent%3Fuid%3Dflow-1",
  );
  expect(mock.call).not.toHaveBeenCalled();
});

it("refuses a missing or mismatched nonce at submission even after rendering", async () => {
  await page();
  mock.cookies.clear();
  expect((await consentDecide("flow-1", ["read"], false)).ok).toBe(false);
  expect(mutations()).toHaveLength(0);
  mock.cookies.set("mdf_flow", "b".repeat(43));
  mock.call.mockResolvedValue({
    ok: false,
    code: "unauthorized",
    message: "consent nonce required",
  });
  render(await page());
  expect(screen.getByRole("alert")).toHaveTextContent("Avvia di nuovo");
  expect(
    (await consentDecide("flow-1", ["spend"], false, info.client_name)).ok,
  ).toBe(false);
  expect(mutations()).toHaveLength(0);
});

it("requires the HTTPS host cookie without falling back to an unprefixed cookie", async () => {
  vi.stubEnv("SITE_URL", "https://app.mellodifai.com");
  render(await page());
  expect(screen.getByRole("alert")).toHaveTextContent("Avvia di nuovo");
  expect(mock.call).not.toHaveBeenCalled();
  mock.cookies.set("__Host-mdf_flow", "s".repeat(43));
  expect((await consentDecide("flow-1", ["read"], false)).ok).toBe(true);
  expect(mutations()[0][1][2]).toBe("s".repeat(43));
});

it("never shows consent or test mode to a non-admin", async () => {
  mock.call.mockResolvedValue({
    ok: false,
    code: "forbidden_scope",
    message: "admin required",
  });
  render(await page());
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect((await consentDecide("flow-1", ["read"], true)).ok).toBe(false);
});

it("does not offer scopes that the client did not request", async () => {
  mock.call.mockResolvedValue({
    ok: true,
    data: { ...info, requested_scopes: ["read"] },
  });
  render(await page());
  expect(screen.getByRole("checkbox", { name: "Creare" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(screen.getByRole("checkbox", { name: "Spendere" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

it("allows read consent remotely without spending confirmation", async () => {
  mock.headers.set("cf-connecting-ip", "192.0.2.1");
  expect(await consentDecide("flow-1", ["read"], false)).toEqual({ ok: true });
  expect(mutations()[0][1]).toEqual([
    expect.objectContaining({ remote: true, actor_kind: "session" }),
    "flow-1",
    nonce,
    ["read"],
    false,
  ]);
});

it("compares the confirmation with the current stored name, not the rendered name", async () => {
  await page();
  mock.call.mockResolvedValue({
    ok: true,
    data: { ...info, client_name: "Nome aggiornato" },
  });
  expect(
    await consentDecide("flow-1", ["spend"], false, info.client_name),
  ).toMatchObject({ ok: false, code: "validation" });
  expect(mutations()).toHaveLength(0);
});

it("refuses a malformed flow cookie before displaying client details or deciding", async () => {
  mock.cookies.set("mdf_flow", "short");
  render(await page());
  expect(screen.getByRole("alert")).toHaveTextContent("Avvia di nuovo");
  expect((await consentDecide("flow-1", ["read"], false)).ok).toBe(false);
  expect(mock.call).not.toHaveBeenCalled();
});

it.each([undefined, ["one", "two"], ""])(
  "refuses invalid page uid %s",
  async (uid) => {
    render(await ConsentPage({ searchParams: Promise.resolve({ uid }) }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(mock.call).not.toHaveBeenCalled();
  },
);

it("validates action arguments and requires a session", async () => {
  // Server Actions receive untrusted values despite their TypeScript signatures.
  for (const scopes of [[], ["admin"], null])
    expect((await consentDecide("flow-1", scopes as never, false)).ok).toBe(
      false,
    );
  expect((await consentDecide("flow-1", ["read"], "true" as never)).ok).toBe(
    false,
  );
  expect(mutations()).toHaveLength(0);
  mock.claims.mockRejectedValue(new Error("Unauthorized"));
  expect(await consentDecide("flow-1", ["read"], false)).toMatchObject({
    ok: false,
    code: "unauthorized",
  });
});
