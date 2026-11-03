import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const server = Array.isArray(base.webServer)
  ? base.webServer[0]
  : base.webServer;
if (!server) throw new Error("The e2e web server is required");

export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: "ui-polish.spec.ts",
  webServer: server,
});
