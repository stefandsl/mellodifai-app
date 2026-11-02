// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), unsafe: vi.fn() }));
vi.mock("postgres", () => ({ default: mocks.connect }));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("MDF_WEB_DATABASE_URL", "postgresql://test-fixture");
  mocks.connect.mockReturnValue({ unsafe: mocks.unsafe });
});

it("uses one max-10 pool and parameterizes arguments", async () => {
  const { opsSql, callOps } = await import("./ops-client");
  mocks.unsafe.mockResolvedValue([{ result: { ok: true, data: 7 } }]);
  expect(opsSql()).toBe(opsSql());
  expect(mocks.connect).toHaveBeenCalledTimes(1);
  expect(mocks.connect).toHaveBeenCalledWith(
    "postgresql://test-fixture",
    expect.objectContaining({ max: 10 }),
  );
  expect(
    await callOps("idem_begin", [
      { actor_kind: "session" },
      "a'quoted-key",
      "hash",
    ]),
  ).toEqual({ ok: true, data: 7 });
  expect(mocks.unsafe).toHaveBeenCalledWith(
    'select ops."idem_begin"($1, $2, $3) as result',
    [{ actor_kind: "session" }, "a'quoted-key", "hash"],
  );
});
it("refuses SQL fragments in function names and preserves structured errors", async () => {
  const { callOps } = await import("./ops-client");
  expect(await callOps("health(); delete", [])).toMatchObject({
    ok: false,
    code: "validation",
  });
  expect(mocks.connect).not.toHaveBeenCalled();
  const result = {
    ok: false,
    code: "in_progress",
    message: "Request in progress",
    retry_after: 2,
  };
  mocks.unsafe.mockResolvedValue([{ result }]);
  expect(await callOps("idem_begin", [])).toEqual(result);
});
it("redacts transport and unexpected SQL errors", async () => {
  const { callOps } = await import("./ops-client");
  mocks.unsafe.mockRejectedValue(new Error("private password and query"));
  expect(await callOps("health", [])).toEqual({
    ok: false,
    code: "internal",
    message: "Internal error",
  });
});
