// @vitest-environment node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_OPS } from "@/lib/ops/registry";
import { commands as CLI_COMMANDS } from "../../../../packages/cli/src/commands";
import {
  AGENTS,
  CANONICAL_MCP_URL,
  extractCliCommands,
  extractMcpUrls,
  getAllAgentProfiles,
  getMcpTools,
  hasForbiddenSecret,
  INITIAL_VISIBLE_TOOLS,
  MCP_TOOL_CATEGORIES,
} from "./agents";
import { SITE_COPY } from "./copy";
import { DEFAULT_AGENT, parseAgentParam } from "./nav";

const WEB_DIR = resolve(import.meta.dirname, "../..");

describe("lib/site/agents truth and build-time MCP registry", () => {
  it("reads the real MCP tool list directly from TOKEN_OPS with no missing or extra tools", () => {
    const tools = getMcpTools();
    const opsByName = new Map(TOKEN_OPS.map((op) => [op.name, op]));
    expect(tools.length).toBe(TOKEN_OPS.length);
    expect(tools.length).toBeGreaterThanOrEqual(38);
    expect([...tools.map((t) => t.name)].sort()).toEqual(
      [...TOKEN_OPS.map((op) => op.name)].sort(),
    );
    for (const tool of tools) {
      const op = opsByName.get(tool.name);
      expect(op, tool.name).toBeDefined();
      if (!op) continue;
      expect(tool.description).toBe(op.description);
      expect(tool.scope).toBe(op.scope);
      expect(tool.readOnly).toBe(!op.mutating);
      expect(MCP_TOOL_CATEGORIES).toContain(tool.category);
      expect(tool.category).not.toBe("all");
    }
    expect(INITIAL_VISIBLE_TOOLS).toBeGreaterThan(0);
    expect(INITIAL_VISIBLE_TOOLS).toBeLessThan(tools.length);
  });

  it("parses ?agent= values safely and defaults unknown values to claude", () => {
    expect(DEFAULT_AGENT).toBe("claude");
    for (const agent of AGENTS) {
      expect(parseAgentParam(agent)).toBe(agent);
      expect(parseAgentParam(`  ${agent.toUpperCase()} `)).toBe(agent);
    }
    expect(parseAgentParam(null)).toBe("claude");
    expect(parseAgentParam(undefined)).toBe("claude");
    expect(parseAgentParam("")).toBe("claude");
    expect(parseAgentParam("invalid-agent")).toBe("claude");
  });

  it("defines 3 honest connect steps for all 5 agents in EN and IT with real CLI commands, real MCP URLs, zero secrets, and zero em dashes", () => {
    const cliSet = new Set<string>(CLI_COMMANDS);
    const seenCli = new Set<string>();
    const seenMcp = new Set<string>();

    for (const lang of ["en", "it"] as const) {
      const profiles = getAllAgentProfiles(lang);
      expect(Object.keys(profiles).sort()).toEqual([...AGENTS].sort());

      for (const id of AGENTS) {
        const profile = profiles[id];
        expect(profile.connectSteps).toHaveLength(3);

        for (const step of profile.connectSteps) {
          expect(step.title.length).toBeGreaterThan(3);
          expect(step.line.length).toBeGreaterThan(10);
          expect(step.title).not.toContain("\u2014");
          expect(step.line).not.toContain("\u2014");

          if (step.copyText) {
            expect(
              hasForbiddenSecret(step.copyText),
              `${id}/${lang}: ${step.copyText}`,
            ).toBe(false);
            expect(step.copyText).not.toContain("\u2014");

            for (const cmd of extractCliCommands(step.copyText)) {
              expect(
                cliSet.has(cmd),
                `CLI command "${cmd}" in ${id}/${lang} must exist in packages/cli/src/commands.ts`,
              ).toBe(true);
              seenCli.add(cmd);
            }

            for (const url of extractMcpUrls(step.copyText)) {
              expect(url).toBe(CANONICAL_MCP_URL);
              expect(new URL(url).pathname).toBe("/api/mcp");
              seenMcp.add(url);
            }
          }
        }
      }

      // Verify clean-room copy has zero em dashes anywhere in agents section.
      const copyJson = JSON.stringify(SITE_COPY[lang].agents);
      expect(copyJson).not.toContain("\u2014");
    }

    expect(seenCli.size).toBeGreaterThanOrEqual(2);
    expect(seenMcp.has(CANONICAL_MCP_URL)).toBe(true);
    expect(
      extractCliCommands("claude mcp add mellodifai -- mellodifai mcp"),
    ).toEqual(["mcp"]);
    expect(
      extractCliCommands(
        "gemini mcp add --transport http mellodifai https://app.mellodifai.com/api/mcp",
      ),
    ).toEqual([]);
  });

  it("flags secret-like strings in hasForbiddenSecret", () => {
    expect(hasForbiddenSecret("mellodifai login")).toBe(false);
    expect(hasForbiddenSecret(CANONICAL_MCP_URL)).toBe(false);
    expect(hasForbiddenSecret("Authorization: Bearer mdf_secret123456")).toBe(
      true,
    );
    expect(hasForbiddenSecret("export MELLODIFAI_TOKEN=abc")).toBe(true);
    expect(hasForbiddenSecret("sk-proj-123456789012345678901234")).toBe(true);
  });

  it("keeps mcp-chatgpt and mcp-claude layout-ref files valid with explicit repairs", () => {
    for (const [file, route] of [
      ["mcp-chatgpt.json", "/agents?agent=chatgpt"],
      ["mcp-claude.json", "/agents?agent=claude"],
    ] as const) {
      const ref = JSON.parse(
        readFileSync(join(WEB_DIR, "e2e/site/layout-ref", file), "utf8"),
      ) as {
        route: string;
        sections: string[];
        widths: Record<string, unknown>;
        repairs: Array<{ path: string; source: string; reason: string }>;
      };
      expect(ref.route).toBe(route);
      expect(ref.sections).toHaveLength(8);
      expect(Object.keys(ref.widths).sort()).toEqual(["1024", "1440", "390"]);
      expect(Array.isArray(ref.repairs)).toBe(true);
      expect(ref.repairs.length).toBeGreaterThan(0);
      for (const r of ref.repairs) {
        expect(r.source).toMatch(
          /^pages\/mcp-(chatgpt|claude)\/outline-(390|1024|1440)\.json/u,
        );
        expect(r.reason.length).toBeGreaterThan(5);
      }
    }
  });
});
