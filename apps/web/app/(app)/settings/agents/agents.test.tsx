import { createHash } from "node:crypto";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    headers: new Headers(),
    claims: vi.fn(),
    profile: vi.fn(),
    call: vi.fn(),
    refresh,
    router: { refresh },
  };
});
vi.mock("next/headers", () => ({ headers: async () => mock.headers }));
vi.mock("next/navigation", () => ({ useRouter: () => mock.router }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getActionClaims: mock.claims,
  requireProfile: mock.profile,
}));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "it" }));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mock.call }));
vi.mock("@/components/studio/studio-shell", () => ({
  StudioPage: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));

import SettingsPage from "../page";
import { createToken, openPairing, revokeToken, setRemoteMcp } from "./actions";
import { AgentsPanel } from "./agents-panel";
import AgentsPage from "./page";

const id = "00000000-0000-4000-8000-000000000001";
const row = {
  id,
  name: "Claude",
  kind: "pat",
  token_hint: "mdf_pat_...1234",
  scopes: ["read"],
  remote: false,
  test_mode: true,
  expires_at: null,
  last_used_at: null,
  revoked_at: null,
};
const pairing = {
  open_until: null,
  client_name: null,
  redirect_host: null,
  registered_at: null,
};
const input = {
  name: "Claude",
  scopes: ["read"] as Array<"read">,
  remote: false,
  testMode: false,
  expiresAt: null,
};
const mutations = () =>
  mock.call.mock.calls.filter(([fn]) =>
    [
      "admin_token_create",
      "admin_token_revoke",
      "admin_flag_set",
      "admin_pairing_open",
    ].includes(fn),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mock.headers = new Headers();
  mock.claims.mockResolvedValue({ sub: "owner", session_id: "session" });
  mock.profile.mockResolvedValue({
    user: { email: "owner@example.test" },
    profile: { role: "admin" },
  });
  mock.call.mockImplementation(async (fn) => ({
    ok: true,
    data:
      fn === "admin_tokens_list"
        ? [row]
        : fn === "admin_pairing_status"
          ? pairing
          : fn === "admin_pairing_open"
            ? {
                ...pairing,
                open_until: new Date(Date.now() + 600000).toISOString(),
              }
            : fn === "flags"
              ? { remote_mcp: false }
              : fn === "admin_flag_set"
                ? { flag: "remote_mcp", enabled: true }
                : { id },
  }));
});
afterEach(() => vi.useRealTimers());

it("admin only and local only", async () => {
  mock.headers.set("x-mdf-remote", "1");
  render(await AgentsPage());
  expect(
    screen.queryByRole("button", { name: "Nuovo token" }),
  ).not.toBeInTheDocument();
  for (const result of [
    await createToken(input),
    await revokeToken(id),
    await setRemoteMcp(true),
    await openPairing(),
  ])
    expect(result).toMatchObject({ ok: false, code: "forbidden_scope" });
  expect(mock.call).not.toHaveBeenCalled();
  mock.headers = new Headers();
  mock.call.mockResolvedValue({
    ok: false,
    code: "forbidden_scope",
    message: "admin required",
  });
  render(await AgentsPage());
  expect(
    screen.queryByRole("button", { name: "Nuovo token" }),
  ).not.toBeInTheDocument();
  for (const result of [
    await createToken(input),
    await revokeToken(id),
    await setRemoteMcp(true),
    await openPairing(),
  ])
    expect(result).toMatchObject({ ok: false, code: "forbidden_scope" });
  expect(
    mock.call.mock.calls.every(([, args]) => args[0].actor_kind === "session"),
  ).toBe(true);
});

it("Nuovo token shows the token once", async () => {
  const user = userEvent.setup();
  const view = render(await AgentsPage());
  await user.type(screen.getByLabelText("Nome"), "Claude locale");
  await user.click(screen.getByRole("button", { name: "Nuovo token" }));
  const dialog = await screen.findByRole("dialog");
  const token = dialog.querySelector("code")?.textContent;
  expect(token?.startsWith("mdf_pat_")).toBe(true);
  const args = mutations()[0][1];
  expect(
    args[2] ===
      createHash("sha256")
        .update(token ?? "")
        .digest("hex"),
  ).toBe(true);
  expect(JSON.stringify(args).includes(token ?? "missing")).toBe(false);
  expect(mock.refresh).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Ho salvato il token" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  view.unmount();
  render(await AgentsPage());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText(row.token_hint)).toBeVisible();
});

it("Revoca asks for confirmation", async () => {
  const user = userEvent.setup();
  render(await AgentsPage());
  await user.click(screen.getByRole("button", { name: "Revoca" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Claude");
  expect(mutations()).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Annulla" }));
  expect(mutations()).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Revoca" }));
  await user.click(screen.getByRole("button", { name: "Conferma" }));
  await waitFor(() =>
    expect(mock.call).toHaveBeenCalledWith("admin_token_revoke", [
      expect.objectContaining({ remote: false }),
      id,
    ]),
  );
  expect(mock.refresh).toHaveBeenCalled();
});

it("explicitly names permission and remote access controls", async () => {
  render(await AgentsPage());
  const controls = [
    screen.getByRole("switch", { name: "MCP remoto" }),
    ...[
      "Leggere",
      "Creare",
      "Spendere",
      "Uso remoto",
      "Test (provider simulati)",
    ].map((name) => screen.getByRole("checkbox", { name })),
  ];
  for (const control of controls) {
    const labelId = control.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const label = document.getElementById(
      labelId as string,
    ) as HTMLLabelElement;
    expect(label.control).toHaveAttribute("type", "checkbox");
    expect(control).toHaveAccessibleName(label.textContent ?? "");
  }
});

it("the remote_mcp switch calls admin_flag_set", async () => {
  render(await AgentsPage());
  fireEvent.click(screen.getByRole("switch", { name: "MCP remoto" }));
  await waitFor(() =>
    expect(mock.call).toHaveBeenCalledWith("admin_flag_set", [
      expect.objectContaining({ actor_kind: "session", remote: false }),
      "remote_mcp",
      true,
    ]),
  );
  expect(mock.refresh).toHaveBeenCalled();
});

it("Collega un agente shows the remaining time and the client that claimed the window (name, redirect host, time; Major 27)", async () => {
  render(await AgentsPage());
  fireEvent.click(screen.getByRole("button", { name: "Collega un agente" }));
  await waitFor(() =>
    expect(mock.call).toHaveBeenCalledWith("admin_pairing_open", [
      expect.objectContaining({ remote: false }),
    ]),
  );
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
  const view = render(
    <AgentsPanel
      tokens={[]}
      remoteMcp={false}
      pairing={{ ...pairing, open_until: "2026-11-06T10:10:00Z" }}
      now={Date.now()}
    />,
  );
  expect(screen.getByText("Tempo rimanente: 10:00")).toBeVisible();
  mock.refresh.mockClear();
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.getByText("Tempo rimanente: 9:55")).toBeVisible();
  expect(mock.refresh).toHaveBeenCalledTimes(1);
  view.rerender(
    <AgentsPanel
      tokens={[]}
      remoteMcp={false}
      pairing={{
        open_until: "2026-11-06T10:00:05Z",
        client_name: "<img src=x>🎵",
        redirect_host: "claude.ai",
        registered_at: "2026-11-06T10:00:05Z",
      }}
      now={Date.now()}
    />,
  );
  expect(screen.getByText("<img src=x>🎵")).toBeVisible();
  expect(screen.getByText("claude.ai")).toBeVisible();
  expect(view.container.querySelector("img")).toBeNull();
  expect(view.container.querySelector("time")).toHaveAttribute(
    "dateTime",
    "2026-11-06T10:00:05Z",
  );
  mock.refresh.mockClear();
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(mock.refresh).not.toHaveBeenCalled();
});

it("stops the pairing countdown at expiry and refreshes the final status", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
  render(
    <AgentsPanel
      tokens={[]}
      remoteMcp={false}
      pairing={{ ...pairing, open_until: "2026-11-06T10:00:02Z" }}
      now={Date.now()}
    />,
  );
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(screen.getByText("Finestra di collegamento chiusa")).toBeVisible();
  expect(mock.refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(mock.refresh).toHaveBeenCalledTimes(1);
});

it("uses the refreshed server time when pairing opens after an idle page", () => {
  const now = Date.parse("2026-11-06T10:00:00Z");
  const view = render(
    <AgentsPanel tokens={[]} remoteMcp={false} pairing={pairing} now={now} />,
  );
  view.rerender(
    <AgentsPanel
      tokens={[]}
      remoteMcp={false}
      pairing={{ ...pairing, open_until: "2026-11-06T11:10:00Z" }}
      now={now + 3600000}
    />,
  );
  expect(screen.getByText("Tempo rimanente: 10:00")).toBeVisible();
});

it("settings navigation exposes Agenti only to a local admin", async () => {
  const view = render(await SettingsPage());
  expect(screen.getByRole("link", { name: "Gestisci agenti" })).toHaveAttribute(
    "href",
    "/settings/agents",
  );
  mock.profile.mockResolvedValue({ user: {}, profile: { role: "customer" } });
  view.rerender(await SettingsPage());
  expect(
    screen.queryByRole("link", { name: "Gestisci agenti" }),
  ).not.toBeInTheDocument();
  mock.profile.mockResolvedValue({ user: {}, profile: { role: "admin" } });
  mock.headers.set("cf-connecting-ip", "192.0.2.1");
  view.rerender(await SettingsPage());
  expect(
    screen.queryByRole("link", { name: "Gestisci agenti" }),
  ).not.toBeInTheDocument();
});

it("validates remote expiry and defaults it to 90 days; local PATs have no expiry", async () => {
  const before = Date.now();
  expect((await createToken({ ...input, remote: true })).ok).toBe(true);
  const expires = Date.parse(mutations()[0][1][7]);
  expect(expires - before).toBeGreaterThanOrEqual(90 * 86400000);
  expect(expires - Date.now()).toBeLessThanOrEqual(90 * 86400000);
  expect((await createToken(input)).ok).toBe(true);
  expect(mutations()[1][1][7]).toBeNull();
  for (const invalid of [
    { ...input, name: "" },
    { ...input, scopes: [] },
    { ...input, remote: true, expiresAt: "2020-01-01T00:00:00Z" },
  ])
    expect((await createToken(invalid)).ok).toBe(false);
  expect(mutations()).toHaveLength(2);
});

it("does not reveal a token on failure or an uncertain committed response", async () => {
  mock.call.mockResolvedValue({
    ok: false,
    code: "internal",
    message: "failure",
  });
  expect(await createToken(input)).not.toHaveProperty("token");
  mock.call.mockResolvedValue({ ok: true, data: {} });
  expect(await createToken(input)).not.toHaveProperty("token");
  mock.claims.mockRejectedValue(new Error("Unauthorized"));
  expect(await createToken(input)).toMatchObject({
    ok: false,
    code: "unauthorized",
  });
});
