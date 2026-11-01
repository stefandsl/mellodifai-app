import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ role: "admin" as "admin" | "member" }));
vi.mock("@/lib/auth", () => ({
  requireProfile: async () => ({
    profile: { id: "u", role: mock.role },
    supabase: {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: { id: "w", last_seen: null, kie_balance: 60 },
              }),
            }),
          }),
        }),
      }),
    },
  }),
}));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "it" }));

import CreditsPage from "./page";

beforeEach(() => {
  mock.role = "admin";
});

it("tells the admin that local engines are free and leave the kie balance alone", async () => {
  render(await CreditsPage());
  expect(screen.getByText(/canzoni ancora possibili/u)).toBeVisible();
  expect(screen.getByText(/ACE-Step e YuE2 girano sul tuo PC/u)).toBeVisible();
});

it("says nothing about local engines to anyone else", async () => {
  mock.role = "member";
  render(await CreditsPage());
  expect(screen.getByText(/canzoni ancora possibili/u)).toBeVisible();
  expect(screen.queryByText(/ACE-Step/u)).not.toBeInTheDocument();
});
