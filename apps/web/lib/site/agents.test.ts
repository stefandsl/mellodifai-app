// @vitest-environment node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_OPS } from "@/lib/ops/registry";
import { commands as CLI_COMMANDS } from "../../../../packages/cli/src/commands";
import {
  AGENTS,
  type AgentsLaunchConfig,
  CLI_INSTALL_COMMAND,
  DEFAULT_AGENTS_LAUNCH_CONFIG,
  extractAllUrls,
  extractCliCommands,
  extractMcpUrls,
  getAllAgentProfiles,
  getMcpTools,
  hasForbiddenSecret,
  INITIAL_VISIBLE_TOOLS,
  LAUNCHED_MCP_URL,
  LOCAL_MCP_URL,
  LOCAL_SITE_ORIGIN,
  MCP_TOOL_CATEGORIES,
  PUBLIC_MCP_URL,
  REPO_AGENTS_DOCS_URL,
} from "./agents";
import { SITE_COPY } from "./copy";
import { DEFAULT_AGENT, parseAgentParam } from "./nav";

const WEB_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(WEB_DIR, "../..");

const LAUNCHED_CONFIG: AgentsLaunchConfig = {
  ...DEFAULT_AGENTS_LAUNCH_CONFIG,
  publicMcpUrl: LAUNCHED_MCP_URL,
};

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

  it("pre-launch state (publicMcpUrl: null) hides dead remote copy buttons, offers real local path + CLI repo install, and pipes PAT to login", () => {
    expect(PUBLIC_MCP_URL).toBeNull();
    const cliSet = new Set<string>(CLI_COMMANDS);

    for (const lang of ["en", "it"] as const) {
      const profiles = getAllAgentProfiles(lang, DEFAULT_AGENTS_LAUNCH_CONFIG);
      expect(Object.keys(profiles).sort()).toEqual([...AGENTS].sort());

      for (const id of AGENTS) {
        const profile = profiles[id];
        expect(profile.connectSteps).toHaveLength(3);

        // No dead parked domain anywhere in pre-launch FAQ or steps.
        expect(profile.faqClientAnswer).not.toContain("app.mellodifai.com");
        expect(profile.faqClientAnswer).toContain(LOCAL_MCP_URL);

        const copySnippets = profile.connectSteps
          .map((s) => s.copyText)
          .filter((t): t is string => Boolean(t));

        // Every copied text must be free of parked domains, fake npm installs, secrets, and em dashes.
        for (const step of profile.connectSteps) {
          expect(step.title.length).toBeGreaterThan(3);
          expect(step.line.length).toBeGreaterThan(10);
          expect(step.title).not.toContain("\u2014");
          expect(step.line).not.toContain("\u2014");
          expect(step.line).not.toContain("app.mellodifai.com");
          expect(step.line).not.toMatch(
            /npm install(?:\s+-g)?\s+@mellodifai\/cli/u,
          );

          if (step.copyText) {
            expect(hasForbiddenSecret(step.copyText), `${id}/${lang}`).toBe(
              false,
            );
            expect(step.copyText).not.toContain("\u2014");
            expect(step.copyText).not.toContain("app.mellodifai.com");
            expect(step.copyText).not.toMatch(
              /npm install(?:\s+-g)?\s+@mellodifai\/cli/u,
            );

            for (const url of extractAllUrls(step.copyText)) {
              const parsed = new URL(url);
              expect(
                ["127.0.0.1", "localhost"].includes(parsed.hostname),
                `pre-launch copy URL must be loopback: ${url}`,
              ).toBe(true);
            }

            for (const cmd of extractCliCommands(step.copyText)) {
              expect(
                cliSet.has(cmd),
                `CLI command "${cmd}" in ${id}/${lang} must exist in packages/cli/src/commands.ts`,
              ).toBe(true);
            }

            // Every copied `mellodifai login` command must pipe stdin (never bare TTY invocation).
            if (step.copyText.includes("mellodifai login")) {
              expect(step.copyText, `${id}/${lang} login pipe`).toMatch(
                /\|\s*mellodifai login\s+--url\s+/u,
              );
            }
          }
        }

        // Every client links to the real repo docs for local setup.
        expect(
          profile.connectSteps.some((s) => s.docHref === REPO_AGENTS_DOCS_URL),
          `${id}/${lang} links repo docs`,
        ).toBe(true);

        // Every client offers the working repo CLI pack/install command.
        expect(
          copySnippets.includes(CLI_INSTALL_COMMAND),
          `${id}/${lang} includes repo CLI install`,
        ).toBe(true);

        // All 4 stdio-capable clients show piped login against local dev origin.
        if (id !== "chatgpt") {
          expect(
            copySnippets.some(
              (c) =>
                c.includes("| mellodifai login") &&
                c.includes(LOCAL_SITE_ORIGIN),
            ),
            `${id}/${lang} includes piped local login`,
          ).toBe(true);
        }
      }

      // ChatGPT step 1 explicitly shows "available at launch" with NO copyable URL.
      const chatgpt = profiles.chatgpt;
      expect(chatgpt.connectSteps[0].copyText).toBeUndefined();
      expect(chatgpt.connectSteps[0].statusBadge).toBeTruthy();

      // Claude and ChatGPT soften menu labels rather than stating one rigid UI label as fact.
      expect(profiles.chatgpt.connectSteps[0].line).toMatch(
        /Apps & Connectors|App e connettori/u,
      );
      expect(profiles.claude.connectSteps[2].line).toMatch(
        /may vary|variabile/u,
      );

      // Clean-room copy has zero em dashes anywhere in agents section.
      expect(JSON.stringify(SITE_COPY[lang].agents)).not.toContain("\u2014");
    }
  });

  it("launched state (publicMcpUrl set) restores remote HTTPS copy steps, uses distinct Gemini server names, and builds FAQ from publicMcpUrl", () => {
    const cliSet = new Set<string>(CLI_COMMANDS);

    for (const lang of ["en", "it"] as const) {
      const profiles = getAllAgentProfiles(lang, LAUNCHED_CONFIG);

      for (const id of ["claude", "chatgpt", "gemini", "cursor"] as const) {
        const urls = profiles[id].connectSteps.flatMap((s) =>
          s.copyText ? extractMcpUrls(s.copyText) : [],
        );
        expect(urls, `${id}/${lang} launched remote MCP URL`).toContain(
          LAUNCHED_MCP_URL,
        );
        expect(
          profiles[id].faqClientAnswer,
          `${id}/${lang} FAQ uses publicMcpUrl`,
        ).toContain(LAUNCHED_MCP_URL);
      }

      // Gemini uses distinct server names: mellodifai-http for HTTP and mellodifai for stdio.
      const geminiHttp = profiles.gemini.connectSteps[0].copyText ?? "";
      const geminiStdio = profiles.gemini.connectSteps[2].copyText ?? "";
      expect(geminiHttp).toContain("--transport http mellodifai-http ");
      expect(geminiStdio).toContain("gemini mcp add -s user mellodifai ");
      expect(geminiStdio).not.toContain("mellodifai-http");

      // Every CLI command across launched profiles still exists and every login uses a stdin pipe.
      for (const id of AGENTS) {
        for (const step of profiles[id].connectSteps) {
          if (!step.copyText) continue;
          expect(hasForbiddenSecret(step.copyText)).toBe(false);
          for (const cmd of extractCliCommands(step.copyText)) {
            expect(cliSet.has(cmd), `${id}/${lang} launched cmd ${cmd}`).toBe(
              true,
            );
          }
          if (step.copyText.includes("mellodifai login")) {
            expect(step.copyText).toMatch(/\|\s*mellodifai login\s+--url\s+/u);
          }
        }
      }
    }
  });

  it("contains zero hardcoded production MCP URLs in agents.ts or copy.ts and documents Claude/ChatGPT web in docs/agents-publishing.md", () => {
    const agentsSrc = readFileSync(join(WEB_DIR, "lib/site/agents.ts"), "utf8");
    const copySrc = readFileSync(join(WEB_DIR, "lib/site/copy.ts"), "utf8");
    expect(agentsSrc).not.toContain("https://app.mellodifai.com/api/mcp");
    expect(copySrc).not.toContain("https://app.mellodifai.com/api/mcp");

    const docs = readFileSync(
      join(REPO_ROOT, "docs/agents-publishing.md"),
      "utf8",
    );
    expect(docs).toContain("### Claude (web and desktop)");
    expect(docs).toContain("### ChatGPT (web)");
    expect(docs).toMatch(/Reviewed 2026-\d{2}-\d{2}/u);
    expect(docs).toContain(CLI_INSTALL_COMMAND);
  });

  it("flags secret-like strings in hasForbiddenSecret and extracts CLI commands accurately", () => {
    expect(hasForbiddenSecret("mellodifai login")).toBe(false);
    expect(
      hasForbiddenSecret(
        `printf %s "$MELLODIFAI_PAT" | mellodifai login --url ${LOCAL_SITE_ORIGIN}`,
      ),
    ).toBe(false);
    expect(hasForbiddenSecret(LOCAL_MCP_URL)).toBe(false);
    expect(hasForbiddenSecret("Authorization: Bearer mdf_secret123456")).toBe(
      true,
    );
    expect(hasForbiddenSecret("export MELLODIFAI_TOKEN=abc")).toBe(true);
    expect(hasForbiddenSecret("sk-proj-123456789012345678901234")).toBe(true);

    expect(
      extractCliCommands("claude mcp add mellodifai -- mellodifai mcp"),
    ).toEqual(["mcp"]);
    expect(
      extractCliCommands(
        'printf %s "$MELLODIFAI_PAT" | mellodifai login --url http://127.0.0.1:3001',
      ),
    ).toEqual(["login"]);
    expect(
      extractCliCommands(
        `gemini mcp add -s user --transport http mellodifai-http ${LOCAL_MCP_URL}`,
      ),
    ).toEqual([]);
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
