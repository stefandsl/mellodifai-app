import { expect, it } from "vitest";
import { applyRolePasswords } from "../lib/roles.js";

it("rejects non-loopback owner connections before sending passwords", async () => {
  await expect(
    applyRolePasswords("postgresql://postgres:test@example.com:5432/postgres", {
      mdf_web: "test",
      mdf_auth: "test",
    }),
  ).rejects.toThrow(/loopback/);
});
