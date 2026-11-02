import { expect, test } from "@playwright/test";

test("health exposes only web remotely and local detail without caching", async ({
  request,
}) => {
  for (const header of ["x-mdf-remote", "cf-connecting-ip", "cf-ray"]) {
    const response = await request.get("/api/health", {
      headers: { [header]: "1" },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ web: "ok" });
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  const local = await request.get("/api/health");
  expect(local.status()).toBe(200);
  expect(await local.json()).toMatchObject({ db: "ok", ops: "ok" });
  expect(Object.keys(await local.json()).sort()).toEqual([
    "db",
    "ops",
    "queue_depth",
    "schema",
    "version",
    "web",
    "worker_heartbeat_age_s",
  ]);
  expect(local.headers()["cache-control"]).toBe("no-store");
});
