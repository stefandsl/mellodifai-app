import { join } from "node:path";
import { expect, it } from "vitest";
import { deployCommands } from "../deploy.js";
import { planDeploy } from "../lib/deploy-plan.js";
import { authServiceCommand, edgeServiceCommand } from "../lib/services.js";

it("starts restricted-account services without tsx or a user-profile lookup", () => {
  const root = "E:/mellodifai";
  const auth = authServiceCommand(root);
  const edge = edgeServiceCommand(root);
  expect(auth.args).toEqual([
    `--env-file=${join(root, "deploy/apps/auth/.env.local")}`,
    "dist/src/main.js",
  ]);
  expect(edge.args).toEqual([join(root, "deploy/ops/dist/edge-proxy.js")]);
  expect(auth.cmd).toBe(process.execPath);
  expect(edge.cmd).toBe(process.execPath);
});

it("builds the edge runtime before starting any application services", () => {
  const plan = planDeploy({
    target: "m1-test",
    hasAuth: true,
    skipMigrations: false,
  });
  const build = plan.find((step) => step.kind === "build-ops");
  if (!build) throw new Error("Missing ops build step");
  expect(plan.indexOf(build)).toBeLessThan(
    plan.findIndex((step) => step.kind === "start"),
  );
  expect(
    deployCommands(build, "E:/mellodifai/deploy", "unused", "pnpm.cjs")[0]
      ?.args,
  ).toEqual([
    "pnpm.cjs",
    "--dir",
    join("E:/mellodifai/deploy", "ops"),
    "exec",
    "tsc",
    "--build",
  ]);
});

it("copies deployment packages so cache ACLs cannot deny service accounts", () => {
  const command = deployCommands(
    { kind: "install", target: "m1-test", hasAuth: true },
    "E:/mellodifai/deploy",
    "unused",
    "pnpm.cjs",
  )[0];
  expect(command?.args).toEqual([
    "pnpm.cjs",
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--package-import-method",
    "copy",
  ]);
});
