// Build-time and server-safe data model for the /agents page (C08).
// Single source of truth:
// - MCP tool list is read directly from TOKEN_OPS in apps/web/lib/ops/registry.ts
//   (the exact array registered by buildMcpServer).
// - Origins and MCP resource paths come from ops/lib/auth-origins.ts.
// - Public launch state lives in DEFAULT_AGENTS_LAUNCH_CONFIG.publicMcpUrl (null until
//   app.mellodifai.com resolves and serves /.well-known/oauth-protected-resource/api/mcp).

import { TOKEN_OPS, type TokenOp } from "@/lib/ops/registry";
import { AUTH_ORIGINS, mcpResource } from "../../../../ops/lib/auth-origins";
import type { SiteLang } from "./copy";
import { AGENTS, type AgentName, DEFAULT_AGENT, parseAgentParam } from "./nav";

export { AGENTS, type AgentName, DEFAULT_AGENT, parseAgentParam };

export const LOCAL_SITE_ORIGIN = AUTH_ORIGINS.dev.siteUrl;
export const LOCAL_MCP_URL = mcpResource(LOCAL_SITE_ORIGIN);
export const DESKTOP_SITE_ORIGIN = AUTH_ORIGINS.desktop.siteUrl;
export const DESKTOP_MCP_URL = mcpResource(DESKTOP_SITE_ORIGIN);
export const LAUNCHED_SITE_ORIGIN = AUTH_ORIGINS.prod.siteUrl;
export const LAUNCHED_MCP_URL = mcpResource(LAUNCHED_SITE_ORIGIN);
export const CANONICAL_MCP_PATH = new URL(LOCAL_MCP_URL).pathname;
export const CANONICAL_MCP_METADATA_PATH = `/.well-known/oauth-protected-resource${CANONICAL_MCP_PATH}`;
export const REPO_AGENTS_DOCS_URL =
  "https://github.com/stefandsl/mellodifai-app/blob/main/docs/agents-publishing.md";
export const CLI_INSTALL_COMMAND =
  "pnpm --filter @mellodifai/cli exec pnpm pack && npm install -g ./packages/cli/mellodifai-cli-0.0.0.tgz";

export type AgentsLaunchConfig = {
  /** Public HTTPS MCP URL once app.mellodifai.com is live, or null before public launch. */
  publicMcpUrl: string | null;
  /** Local dev origin served by `pnpm --filter @mellodifai/web dev`. */
  localSiteOrigin: string;
  /** Local MCP endpoint served by local dev (`http://127.0.0.1:3001/api/mcp`). */
  localMcpUrl: string;
  /** Windows desktop app local MCP endpoint (`http://127.0.0.1:46300/api/mcp`). */
  desktopMcpUrl: string;
  /** Canonical repository guide for running MellodifAI locally and connecting agents. */
  repoDocsUrl: string;
};

/**
 * Explicit launch gate for the public remote MCP address.
 * Keep `publicMcpUrl: null` until app.mellodifai.com resolves and answers
 * `/.well-known/oauth-protected-resource/api/mcp` with HTTP 200.
 * Set `publicMcpUrl: LAUNCHED_MCP_URL` at launch to re-enable remote HTTPS copy steps.
 */
export const DEFAULT_AGENTS_LAUNCH_CONFIG: AgentsLaunchConfig = {
  publicMcpUrl: null,
  localSiteOrigin: LOCAL_SITE_ORIGIN,
  localMcpUrl: LOCAL_MCP_URL,
  desktopMcpUrl: DESKTOP_MCP_URL,
  repoDocsUrl: REPO_AGENTS_DOCS_URL,
};

export const PUBLIC_MCP_URL: string | null =
  DEFAULT_AGENTS_LAUNCH_CONFIG.publicMcpUrl;

export const MCP_TOOL_CATEGORIES = [
  "all",
  "songs",
  "remake",
  "voice_video",
  "publish",
  "jobs",
] as const;

export type McpToolCategory = (typeof MCP_TOOL_CATEGORIES)[number];
export type McpConcreteCategory = Exclude<McpToolCategory, "all">;

export type McpToolInfo = {
  name: string;
  description: string;
  scope: TokenOp["scope"];
  readOnly: boolean;
  category: McpConcreteCategory;
  httpMethod: "GET" | "POST";
  httpPath: string;
  requiresIdempotencyKey: boolean;
};

export type CopyKind = "mcp-url" | "cli";

export type AgentConnectStep = {
  title: string;
  line: string;
  statusBadge?: string;
  docHref?: string;
  docLabel?: string;
  copyText?: string;
  copyLabel?: string;
  copyKind?: CopyKind;
};

export type AgentMockChat = {
  clientLabel: string;
  userPrompt: string;
  toolName: string;
  toolMeta: string;
  assistantReply: string;
};

export type AgentProfile = {
  id: AgentName;
  name: string;
  transportBadge: string;
  heroLineA: string;
  heroLineB: string;
  heroLede: string;
  primaryCtaLabel: string;
  primaryCtaHref: string;
  connectCtaLabel: string;
  connectCtaHref: string;
  connectSteps: [AgentConnectStep, AgentConnectStep, AgentConnectStep];
  mockChat: AgentMockChat;
  faqClientAnswer: string;
};

export const INITIAL_VISIBLE_TOOLS = 12;

export const AGENT_DISPLAY_NAMES: Record<AgentName, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  codex: "Codex",
  cursor: "Cursor",
};

const SONG_TOOLS = new Set([
  "songs_list",
  "song_get",
  "song_create",
  "lyrics_approve",
  "lyrics_back",
  "song_generate_again",
  "take_pick",
]);

const VOICE_VIDEO_TOOLS = new Set([
  "stems_request",
  "video_make",
  "video_rerender",
  "video_approve",
  "visualizer_request",
]);

const JOB_COST_TOOLS = new Set([
  "job_status",
  "job_cancel",
  "stage_retry",
  "costs_get",
]);

// Priority order so the initial 12 cards showcase every core workflow evenly.
const FEATURED_TOOL_ORDER = [
  "remake_start",
  "remake_edit",
  "remake_regenerate_section",
  "song_create",
  "take_pick",
  "stems_request",
  "video_make",
  "music_video_plan_request",
  "publish_plan",
  "publish_request_approval",
  "job_status",
  "costs_get",
];

export function categorizeMcpTool(name: string): McpConcreteCategory {
  if (name.startsWith("remake")) return "remake";
  if (name.startsWith("publish_")) return "publish";
  if (name.startsWith("music_video_") || VOICE_VIDEO_TOOLS.has(name)) {
    return "voice_video";
  }
  if (JOB_COST_TOOLS.has(name) || name.startsWith("job_")) return "jobs";
  if (
    SONG_TOOLS.has(name) ||
    name.startsWith("song") ||
    name.startsWith("lyrics_")
  ) {
    return "songs";
  }
  return "songs";
}

let cachedTools: readonly McpToolInfo[] | null = null;

/**
 * Returns every tool registered by MellodifAI's real MCP server (`TOKEN_OPS`),
 * ordered with representative cross-category tools first and preserving every tool.
 */
export function getMcpTools(): readonly McpToolInfo[] {
  if (cachedTools) return cachedTools;
  const raw: McpToolInfo[] = TOKEN_OPS.map((def) => ({
    name: def.name,
    description: def.description,
    scope: def.scope,
    readOnly: !def.mutating,
    category: categorizeMcpTool(def.name),
    httpMethod: def.http.method,
    httpPath: def.http.path,
    requiresIdempotencyKey: Boolean(def.key),
  }));

  const rank = new Map(FEATURED_TOOL_ORDER.map((n, i) => [n, i]));
  raw.sort((a, b) => {
    const ra = rank.get(a.name) ?? 1000;
    const rb = rank.get(b.name) ?? 1000;
    if (ra !== rb) return ra - rb;
    return 0;
  });

  cachedTools = raw;
  return cachedTools;
}

const SETTINGS_AGENTS_HREF = "/login?next=%2Fsettings%2Fagents";
const CURSOR_ENV_VAR = "$" + "{env:MELLODIFAI_PAT}";

function originOf(url: string): string {
  return new URL(url).origin;
}

function buildLoginCommand(origin: string): string {
  return `printf %s "$MELLODIFAI_PAT" | mellodifai login --url ${origin}`;
}

function buildProfilesEn(
  config: AgentsLaunchConfig,
): Record<AgentName, AgentProfile> {
  const remoteUrl = config.publicMcpUrl;
  const activeOrigin = remoteUrl ? originOf(remoteUrl) : config.localSiteOrigin;
  const loginCommand = buildLoginCommand(activeOrigin);
  const localDocLabel = "Read local setup docs";

  return {
    claude: {
      id: "claude",
      name: "Claude",
      transportBadge: remoteUrl
        ? "Remote MCP or CLI bridge"
        : "Local CLI bridge (remote at launch)",
      heroLineA: "Edit songs right inside",
      heroLineB: "Claude",
      heroLede: remoteUrl
        ? "Connect Claude to MellodifAI over Streamable HTTP MCP or the local CLI bridge. Inspect tracks, rewrite verses, pick takes, and prepare releases."
        : "Connect Claude Code to your local MellodifAI studio over the CLI stdio bridge today. Remote HTTPS connectors for Claude web activate at public launch.",
      primaryCtaLabel: "Connect Claude",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: remoteUrl
        ? [
            {
              title: "Add the MellodifAI connector",
              line: "In Claude Settings -> Connectors (the exact menu label can differ by client rollout), add a custom connector with our remote MCP address.",
              copyText: remoteUrl,
              copyLabel: "Copy MCP address",
              copyKind: "mcp-url",
            },
            {
              title: "Or install CLI and sign in via stdin",
              line: "Prefer Claude Code stdio? Install the CLI from the repo, then pipe MELLODIFAI_PAT into mellodifai login (never pass tokens as arguments).",
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: loginCommand,
              copyLabel: "Copy CLI login command",
              copyKind: "cli",
            },
            {
              title: "Register Claude Code stdio bridge",
              line: "Add the local mellodifai mcp server in Claude Code, then ask Claude to list songs, start a YouTube remake, or refine a verse.",
              copyText: "claude mcp add mellodifai -- mellodifai mcp",
              copyLabel: "Copy Claude Code command",
              copyKind: "cli",
            },
          ]
        : [
            {
              title: "Install the CLI from the repo",
              line: `@mellodifai/cli is not yet on npm. Pack and install it from a repo checkout while MellodifAI runs locally at ${config.localSiteOrigin} (or ${config.desktopMcpUrl} in the Windows app).`,
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: CLI_INSTALL_COMMAND,
              copyLabel: "Copy CLI install command",
              copyKind: "cli",
            },
            {
              title: "Sign in with your PAT via stdin",
              line: "Create a scoped personal token in Settings -> Agents on your local studio and pipe MELLODIFAI_PAT into mellodifai login.",
              copyText: loginCommand,
              copyLabel: "Copy CLI login command",
              copyKind: "cli",
            },
            {
              title: "Register Claude Code stdio bridge",
              line: "Add mellodifai mcp in Claude Code to work on songs today. Remote HTTPS access for Claude web (Settings -> Connectors, label may vary by rollout) opens at public launch.",
              statusBadge: "Remote HTTPS available at launch",
              copyText: "claude mcp add mellodifai -- mellodifai mcp",
              copyLabel: "Copy Claude Code command",
              copyKind: "cli",
            },
          ],
      mockChat: {
        clientLabel: "Claude",
        userPrompt:
          "Rewrite verse two of my Italian track with a warmer bridge and check today's spend cap first.",
        toolName: "costs_get -> remake_edit",
        toolMeta: "read + spend scope, idempotency_key attached",
        assistantReply:
          "Spend cap has headroom. I updated verse two on revision 3 and queued the originality check.",
      },
      faqClientAnswer: remoteUrl
        ? `Claude connects over Streamable HTTP MCP at ${remoteUrl} in Settings -> Connectors (label may vary by rollout) using OAuth, or through Claude Code with claude mcp add mellodifai -- mellodifai mcp after piped mellodifai login.`
        : `Today, Claude Code connects via the local mellodifai mcp stdio bridge after installing @mellodifai/cli from the repo and signing in to ${config.localSiteOrigin} (local MCP endpoint: ${config.localMcpUrl}). Remote HTTPS connectors for Claude web open at public launch.`,
    },
    chatgpt: {
      id: "chatgpt",
      name: "ChatGPT",
      transportBadge: remoteUrl
        ? "Remote MCP + OAuth"
        : "Remote MCP available at launch",
      heroLineA: "Shape every take inside",
      heroLineB: "ChatGPT",
      heroLede: remoteUrl
        ? "Attach MellodifAI as a custom MCP connector in ChatGPT. Review songs, rewrite lines, request stems, and queue private YouTube drafts."
        : "ChatGPT web requires our public HTTPS MCP server, which activates at launch. Today you can run MellodifAI locally and connect local MCP clients or Codex CLI.",
      primaryCtaLabel: "Connect ChatGPT",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: remoteUrl
        ? [
            {
              title: "Add a custom MCP server",
              line: "Open ChatGPT Settings -> Connectors (or Apps & Connectors depending on rollout, with Developer Mode enabled where required) and paste our HTTPS MCP address with OAuth.",
              copyText: remoteUrl,
              copyLabel: "Copy MCP address",
              copyKind: "mcp-url",
            },
            {
              title: "Approve OAuth scopes",
              line: "Sign in to MellodifAI on the consent screen and confirm which permissions (read, create, spend) ChatGPT may use.",
            },
            {
              title: "Pick MellodifAI in a new chat",
              line: "Attach the MellodifAI connector in the composer and ask ChatGPT to inspect takes, edit lyrics, or prepare a private release plan.",
            },
          ]
        : [
            {
              title: "Remote HTTPS connector",
              line: "ChatGPT web requires a live public HTTPS MCP host. At public launch you will paste our HTTPS MCP address in Settings -> Connectors (or Apps & Connectors depending on rollout, with Developer Mode on eligible plans).",
              statusBadge: "Available at launch",
            },
            {
              title: "Run MellodifAI locally today",
              line: `Until launch, run the studio locally (serving ${config.localMcpUrl}, or ${config.desktopMcpUrl} in the Windows app) and install the CLI from the repo to connect local MCP clients or Codex CLI.`,
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: CLI_INSTALL_COMMAND,
              copyLabel: "Copy CLI install command",
              copyKind: "cli",
            },
            {
              title: "OAuth consent at launch",
              line: "Once public launch opens, ChatGPT will redirect to MellodifAI's OAuth consent screen so you approve read, create, or spend scopes before using MellodifAI in chat.",
            },
          ],
      mockChat: {
        clientLabel: "ChatGPT",
        userPrompt:
          "Show my latest tracks, pick take 2 on the acoustic cover, and plan a private YouTube upload.",
        toolName: "songs_list -> take_pick -> publish_plan",
        toolMeta: "read + create scope, video stays private",
        assistantReply:
          "Take 2 is selected and timing is queued. A private YouTube draft is ready for your review in MellodifAI.",
      },
      faqClientAnswer: remoteUrl
        ? `ChatGPT connects through a custom MCP server in Settings -> Connectors (or Apps & Connectors depending on rollout, with Developer Mode on eligible plans) using ${remoteUrl} and OAuth.`
        : `ChatGPT web remote MCP requires our public HTTPS server and will be available at public launch. Today you can run MellodifAI locally (${config.localMcpUrl}) and connect local clients or Codex CLI via the repo CLI.`,
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      transportBadge: remoteUrl
        ? "Gemini CLI MCP"
        : "Gemini CLI local MCP (remote at launch)",
      heroLineA: "Drive your studio from",
      heroLineB: "Gemini",
      heroLede: remoteUrl
        ? "Register MellodifAI in Gemini CLI over Streamable HTTP (mellodifai-http) or the local stdio bridge (mellodifai). Keep trust disabled so every write asks first."
        : "Register your local MellodifAI studio in Gemini CLI using the stdio bridge today, with trust kept off so every write asks first. Remote HTTPS activates at launch.",
      primaryCtaLabel: "Connect Gemini",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: remoteUrl
        ? [
            {
              title: "Register remote HTTP as mellodifai-http",
              line: "Add the HTTP transport to ~/.gemini/settings.json under the distinct name mellodifai-http so it never overwrites the local stdio entry (keep trust false).",
              copyText: `gemini mcp add -s user --transport http mellodifai-http ${remoteUrl}`,
              copyLabel: "Copy Gemini HTTP command",
              copyKind: "mcp-url",
            },
            {
              title: "Or install CLI and sign in via stdin",
              line: "To use the local stdio bridge instead, install @mellodifai/cli from the repo and pipe MELLODIFAI_PAT into mellodifai login.",
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: loginCommand,
              copyLabel: "Copy CLI login command",
              copyKind: "cli",
            },
            {
              title: "Register stdio as mellodifai",
              line: "Add the local stdio entry under the name mellodifai, then start Gemini CLI and run /mcp list to verify the loaded tools.",
              copyText: "gemini mcp add -s user mellodifai mellodifai mcp",
              copyLabel: "Copy Gemini stdio command",
              copyKind: "cli",
            },
          ]
        : [
            {
              title: "Install the CLI from the repo",
              line: `@mellodifai/cli is not yet on npm. Pack and install it from a repo checkout alongside your local MellodifAI server (${config.localSiteOrigin}).`,
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: CLI_INSTALL_COMMAND,
              copyLabel: "Copy CLI install command",
              copyKind: "cli",
            },
            {
              title: "Sign in with your PAT via stdin",
              line: "Create a scoped personal token in Settings -> Agents on your local server and pipe MELLODIFAI_PAT into mellodifai login.",
              copyText: loginCommand,
              copyLabel: "Copy CLI login command",
              copyKind: "cli",
            },
            {
              title: "Register stdio in Gemini CLI",
              line: `Add the stdio server as mellodifai (keeping trust false), or register mellodifai-http against local ${config.localMcpUrl}. Public HTTPS HTTP activates at launch.`,
              statusBadge: "Remote HTTPS available at launch",
              copyText: "gemini mcp add -s user mellodifai mellodifai mcp",
              copyLabel: "Copy Gemini stdio command",
              copyKind: "cli",
            },
          ],
      mockChat: {
        clientLabel: "Gemini CLI",
        userPrompt:
          "List my remakes in review and regenerate only the chorus section on remake 4b12.",
        toolName: "remakes_list -> remake_regenerate_section",
        toolMeta: "read + spend scope, user confirmation required",
        assistantReply:
          "Found 1 remake in review. After your confirmation, chorus regeneration started under job 9f2a.",
      },
      faqClientAnswer: remoteUrl
        ? `Gemini CLI registers MellodifAI under two distinct names in ~/.gemini/settings.json: mellodifai-http for Streamable HTTP (${remoteUrl}) and mellodifai for the local mellodifai mcp stdio bridge, keeping trust off.`
        : `Gemini CLI connects today via the local mellodifai mcp stdio bridge (server name mellodifai) or local HTTP at ${config.localMcpUrl} (server name mellodifai-http), with trust kept off. Public HTTPS HTTP opens at launch.`,
    },
    codex: {
      id: "codex",
      name: "Codex",
      transportBadge: remoteUrl ? "Codex CLI + MCP" : "Codex CLI local MCP",
      heroLineA: "Automate song edits with",
      heroLineB: "Codex",
      heroLede:
        "Install the MellodifAI CLI from the repo, sign in via stdin, and register mellodifai in ~/.codex/config.toml to run audited song workflows from your terminal.",
      primaryCtaLabel: "Connect Codex",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Install the CLI from the repo",
          line: `@mellodifai/cli is not yet published on npm. Pack and install the bundled binary from a repository checkout (local server: ${config.localSiteOrigin}).`,
          docHref: config.repoDocsUrl,
          docLabel: localDocLabel,
          copyText: CLI_INSTALL_COMMAND,
          copyLabel: "Copy CLI install command",
          copyKind: "cli",
        },
        {
          title: "Authenticate via CLI stdin",
          line: "Create a personal token in Settings -> Agents and pipe MELLODIFAI_PAT via stdin to mellodifai login without placing secrets in arguments or config files.",
          copyText: loginCommand,
          copyLabel: "Copy CLI login command",
          copyKind: "cli",
        },
        {
          title: "Add MellodifAI to Codex CLI",
          line: "Register the stdio bridge so Codex writes [mcp_servers.mellodifai] into ~/.codex/config.toml, then verify schemas with mellodifai tools or codex mcp list.",
          copyText: "codex mcp add mellodifai -- mellodifai mcp",
          copyLabel: "Copy Codex command",
          copyKind: "cli",
        },
      ],
      mockChat: {
        clientLabel: "Codex CLI",
        userPrompt:
          "Split vocal and band stems on my approved track and poll job_status until done.",
        toolName: "stems_request -> job_status",
        toolMeta: "create + read scope, idempotency_key generated by CLI",
        assistantReply:
          "Queued stem separation and polled until settled. Vocal and instrumental stems are ready in song_get.",
      },
      faqClientAnswer: remoteUrl
        ? `Codex CLI connects through codex mcp add mellodifai -- mellodifai mcp (writing [mcp_servers.mellodifai] to ~/.codex/config.toml) or via Streamable HTTP (${remoteUrl}) with bearer_token_env_var.`
        : `Codex CLI connects today through codex mcp add mellodifai -- mellodifai mcp after installing @mellodifai/cli from the repo and piping MELLODIFAI_PAT to mellodifai login --url ${config.localSiteOrigin} (local MCP: ${config.localMcpUrl}).`,
    },
    cursor: {
      id: "cursor",
      name: "Cursor",
      transportBadge: remoteUrl
        ? "Cursor mcp.json"
        : "Cursor local mcp.json (remote at launch)",
      heroLineA: "Work on tracks inside",
      heroLineB: "Cursor",
      heroLede: remoteUrl
        ? "Configure .cursor/mcp.json with our Streamable HTTP URL or local mellodifai mcp bridge. Keep credentials in environment variables, never in files."
        : "Configure .cursor/mcp.json with the local mellodifai mcp bridge or local dev endpoint today. Remote public HTTPS URLs activate at launch.",
      primaryCtaLabel: "Connect Cursor",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: remoteUrl
        ? [
            {
              title: "Point .cursor/mcp.json at MellodifAI",
              line: `Add a mellodifai-http entry in .cursor/mcp.json or ~/.cursor/mcp.json using our Streamable HTTP MCP URL and ${CURSOR_ENV_VAR} header interpolation.`,
              copyText: remoteUrl,
              copyLabel: "Copy MCP address",
              copyKind: "mcp-url",
            },
            {
              title: "Or install CLI and sign in via stdin",
              line: "Prefer stdio? Install @mellodifai/cli from the repo and pipe MELLODIFAI_PAT into mellodifai login.",
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: loginCommand,
              copyLabel: "Copy CLI login command",
              copyKind: "cli",
            },
            {
              title: "Run the local stdio bridge",
              line: 'Set command to mellodifai and args to ["mcp"] in .cursor/mcp.json, then run /mcp list inside Cursor Agent.',
              copyText: "mellodifai mcp",
              copyLabel: "Copy stdio command",
              copyKind: "cli",
            },
          ]
        : [
            {
              title: "Install the CLI from the repo",
              line: `@mellodifai/cli is not yet on npm. Pack and install it from a repo checkout while MellodifAI runs locally at ${config.localSiteOrigin}.`,
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: CLI_INSTALL_COMMAND,
              copyLabel: "Copy CLI install command",
              copyKind: "cli",
            },
            {
              title: "Sign in with your PAT via stdin",
              line: "Create a scoped personal token in Settings -> Agents on your local server and pipe MELLODIFAI_PAT into mellodifai login.",
              copyText: loginCommand,
              copyLabel: "Copy CLI login command",
              copyKind: "cli",
            },
            {
              title: "Add mellodifai to .cursor/mcp.json",
              line: `Set command to mellodifai and args to ["mcp"] (or point mellodifai-http at local ${config.localMcpUrl}). Remote public HTTPS opens at launch.`,
              statusBadge: "Remote HTTPS available at launch",
              copyText: "mellodifai mcp",
              copyLabel: "Copy stdio command",
              copyKind: "cli",
            },
          ],
      mockChat: {
        clientLabel: "Cursor",
        userPrompt:
          "Generate the free music-video storyboard plan for song 7c18 and quote shot 2 without spending.",
        toolName: "music_video_plan_request -> music_video_take_request",
        toolMeta: "create scope, zero paid spend",
        assistantReply:
          "Storyboard cut plan is ready with 8 shots. Shot 2 quote is saved for your review in the app.",
      },
      faqClientAnswer: remoteUrl
        ? `Cursor reads .cursor/mcp.json or ~/.cursor/mcp.json with either the remote URL ${remoteUrl} (entry mellodifai-http) or the local command mellodifai mcp.`
        : `Cursor connects today via .cursor/mcp.json using the local command mellodifai mcp (after repo CLI install and piped mellodifai login) or local HTTP at ${config.localMcpUrl}. Remote public HTTPS opens at launch.`,
    },
  };
}

function buildProfilesIt(
  config: AgentsLaunchConfig,
): Record<AgentName, AgentProfile> {
  const remoteUrl = config.publicMcpUrl;
  const activeOrigin = remoteUrl ? originOf(remoteUrl) : config.localSiteOrigin;
  const loginCommand = buildLoginCommand(activeOrigin);
  const localDocLabel = "Leggi la guida locale";

  return {
    claude: {
      id: "claude",
      name: "Claude",
      transportBadge: remoteUrl
        ? "MCP remoto o ponte CLI"
        : "Ponte CLI locale (remoto al lancio)",
      heroLineA: "Modifica i brani dentro",
      heroLineB: "Claude",
      heroLede: remoteUrl
        ? "Collega Claude a MellodifAI via Streamable HTTP MCP o con il ponte CLI locale. Controlla i brani, riscrivi strofe, scegli take e prepara bozze."
        : "Collega Claude Code al tuo studio MellodifAI locale con il ponte CLI stdio oggi. I connettori HTTPS remoti per Claude web si attivano al lancio pubblico.",
      primaryCtaLabel: "Collega Claude",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: remoteUrl
        ? [
            {
              title: "Aggiungi il connettore MellodifAI",
              line: "In Claude Impostazioni -> Connettori (il nome del menu puo cambiare in base alla versione) aggiungi un connettore personalizzato con l'indirizzo MCP remoto.",
              copyText: remoteUrl,
              copyLabel: "Copia indirizzo MCP",
              copyKind: "mcp-url",
            },
            {
              title: "Oppure installa CLI e accedi da stdin",
              line: "Preferisci Claude Code stdio? Installa la CLI dal repository e invia MELLODIFAI_PAT via stdin a mellodifai login.",
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: loginCommand,
              copyLabel: "Copia comando login CLI",
              copyKind: "cli",
            },
            {
              title: "Registra il ponte stdio in Claude Code",
              line: "Aggiungi il server locale mellodifai mcp in Claude Code e chiedi di elencare i brani, avviare un rifacimento o rifinire un verso.",
              copyText: "claude mcp add mellodifai -- mellodifai mcp",
              copyLabel: "Copia comando Claude Code",
              copyKind: "cli",
            },
          ]
        : [
            {
              title: "Installa la CLI dal repository",
              line: `@mellodifai/cli non e ancora su npm. Impacchetta e installa il binario dal repository mentre MellodifAI gira in locale su ${config.localSiteOrigin} (o ${config.desktopMcpUrl} nell'app Windows).`,
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: CLI_INSTALL_COMMAND,
              copyLabel: "Copia comando installazione CLI",
              copyKind: "cli",
            },
            {
              title: "Accedi passando il PAT da stdin",
              line: "Crea un token personale in Impostazioni -> Agenti sul server locale e invia MELLODIFAI_PAT tramite pipe a mellodifai login.",
              copyText: loginCommand,
              copyLabel: "Copia comando login CLI",
              copyKind: "cli",
            },
            {
              title: "Registra il ponte stdio in Claude Code",
              line: "Aggiungi mellodifai mcp in Claude Code per lavorare oggi. Il connettore HTTPS remoto in Claude web (Impostazioni -> Connettori, etichetta variabile per versione) apre al lancio.",
              statusBadge: "HTTPS remoto disponibile al lancio",
              copyText: "claude mcp add mellodifai -- mellodifai mcp",
              copyLabel: "Copia comando Claude Code",
              copyKind: "cli",
            },
          ],
      mockChat: {
        clientLabel: "Claude",
        userPrompt:
          "Riscrivi la seconda strofa del mio brano in italiano con un bridge piu caldo e controlla prima i limiti di oggi.",
        toolName: "costs_get -> remake_edit",
        toolMeta: "permessi read + spend, idempotency_key allegata",
        assistantReply:
          "Il limite giornaliero ha margine. Ho aggiornato la strofa sulla revisione 3 e messo in coda la verifica.",
      },
      faqClientAnswer: remoteUrl
        ? `Claude si collega via Streamable HTTP MCP su ${remoteUrl} da Impostazioni -> Connettori (il nome del menu puo cambiare) con OAuth, oppure da Claude Code con claude mcp add mellodifai -- mellodifai mcp dopo mellodifai login da stdin.`
        : `Oggi Claude Code si collega con il ponte stdio locale mellodifai mcp dopo aver installato @mellodifai/cli dal repository ed eseguito il login su ${config.localSiteOrigin} (endpoint MCP locale: ${config.localMcpUrl}). Il connettore HTTPS remoto per Claude web apre al lancio.`,
    },
    chatgpt: {
      id: "chatgpt",
      name: "ChatGPT",
      transportBadge: remoteUrl
        ? "MCP remoto + OAuth"
        : "MCP remoto disponibile al lancio",
      heroLineA: "Rifinisci ogni take in",
      heroLineB: "ChatGPT",
      heroLede: remoteUrl
        ? "Collega MellodifAI come connettore MCP personalizzato in ChatGPT. Controlla brani, riscrivi versi, separa gli stem e prepara bozze YouTube private."
        : "ChatGPT web richiede il server HTTPS MCP pubblico, che si attiva al lancio. Oggi puoi avviare MellodifAI in locale e collegare client MCP locali o Codex CLI.",
      primaryCtaLabel: "Collega ChatGPT",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: remoteUrl
        ? [
            {
              title: "Aggiungi un server MCP personalizzato",
              line: "Apri ChatGPT Impostazioni -> Connettori (o App e connettori in base alla versione, con Developer Mode attivo dove richiesto) e incolla l'indirizzo MCP HTTPS con OAuth.",
              copyText: remoteUrl,
              copyLabel: "Copia indirizzo MCP",
              copyKind: "mcp-url",
            },
            {
              title: "Approva i permessi OAuth",
              line: "Accedi a MellodifAI nella schermata di consenso e scegli quali permessi (read, create, spend) concedere a ChatGPT.",
            },
            {
              title: "Seleziona MellodifAI in chat",
              line: "Allega il connettore nella nuova chat e chiedi a ChatGPT di confrontare le take, correggere il testo o preparare una bozza di pubblicazione.",
            },
          ]
        : [
            {
              title: "Connettore HTTPS remoto",
              line: "ChatGPT web richiede un server HTTPS MCP pubblico attivo. Al lancio potrai incollare l'indirizzo HTTPS in Impostazioni -> Connettori (o App e connettori in base alla versione, con Developer Mode sui piani supportati).",
              statusBadge: "Disponibile al lancio",
            },
            {
              title: "Avvia MellodifAI in locale oggi",
              line: `Fino al lancio, avvia lo studio in locale (su ${config.localMcpUrl}, oppure ${config.desktopMcpUrl} nell'app Windows) e installa la CLI dal repository per usare client MCP locali o Codex CLI.`,
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: CLI_INSTALL_COMMAND,
              copyLabel: "Copia comando installazione CLI",
              copyKind: "cli",
            },
            {
              title: "Consenso OAuth al lancio",
              line: "Quando il lancio pubblico sara attivo, ChatGPT aprira la schermata di consenso OAuth di MellodifAI per approvare read, create o spend prima di usare il connettore in chat.",
            },
          ],
      mockChat: {
        clientLabel: "ChatGPT",
        userPrompt:
          "Mostra i miei ultimi brani, scegli la take 2 della cover acustica e prepara una bozza privata per YouTube.",
        toolName: "songs_list -> take_pick -> publish_plan",
        toolMeta: "permessi read + create, il video resta privato",
        assistantReply:
          "Ho selezionato la take 2 e messo in coda il timing. La bozza privata YouTube e pronta per la tua verifica in app.",
      },
      faqClientAnswer: remoteUrl
        ? `ChatGPT si collega tramite server MCP personalizzato in Impostazioni -> Connettori (o App e connettori in base alla versione, con Developer Mode sui piani supportati) usando ${remoteUrl} e OAuth.`
        : `Il connettore remoto su ChatGPT web richiede il server HTTPS pubblico e sara disponibile al lancio. Oggi puoi avviare MellodifAI in locale (${config.localMcpUrl}) e collegare client locali o Codex CLI dal repository.`,
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      transportBadge: remoteUrl
        ? "Gemini CLI MCP"
        : "Gemini CLI locale (remoto al lancio)",
      heroLineA: "Guida lo studio da",
      heroLineB: "Gemini",
      heroLede: remoteUrl
        ? "Registra MellodifAI in Gemini CLI via Streamable HTTP (mellodifai-http) o con il ponte stdio locale (mellodifai). Mantieni trust disattivato."
        : "Registra lo studio locale in Gemini CLI tramite ponte stdio oggi, mantenendo trust disattivato per confermare ogni scrittura. HTTPS remoto apre al lancio.",
      primaryCtaLabel: "Collega Gemini",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: remoteUrl
        ? [
            {
              title: "Registra HTTP remoto come mellodifai-http",
              line: "Aggiungi il trasporto HTTP in ~/.gemini/settings.json con il nome distinto mellodifai-http cosi non sovrascrive la voce stdio locale (senza --trust).",
              copyText: `gemini mcp add -s user --transport http mellodifai-http ${remoteUrl}`,
              copyLabel: "Copia comando HTTP Gemini",
              copyKind: "mcp-url",
            },
            {
              title: "Oppure installa CLI e accedi da stdin",
              line: "Preferisci il ponte stdio locale? Installa @mellodifai/cli dal repository e invia MELLODIFAI_PAT tramite pipe a mellodifai login.",
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: loginCommand,
              copyLabel: "Copia comando login CLI",
              copyKind: "cli",
            },
            {
              title: "Registra stdio come mellodifai",
              line: "Aggiungi la voce stdio locale con il nome mellodifai, poi avvia Gemini CLI ed esegui /mcp list per verificare gli strumenti.",
              copyText: "gemini mcp add -s user mellodifai mellodifai mcp",
              copyLabel: "Copia comando stdio Gemini",
              copyKind: "cli",
            },
          ]
        : [
            {
              title: "Installa la CLI dal repository",
              line: `@mellodifai/cli non e ancora su npm. Impacchetta e installa il binario dal repository insieme al tuo server locale (${config.localSiteOrigin}).`,
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: CLI_INSTALL_COMMAND,
              copyLabel: "Copia comando installazione CLI",
              copyKind: "cli",
            },
            {
              title: "Accedi passando il PAT da stdin",
              line: "Crea un token personale in Impostazioni -> Agenti sul server locale e invia MELLODIFAI_PAT tramite pipe a mellodifai login.",
              copyText: loginCommand,
              copyLabel: "Copia comando login CLI",
              copyKind: "cli",
            },
            {
              title: "Registra stdio in Gemini CLI",
              line: `Aggiungi il server stdio come mellodifai (senza --trust), oppure registra mellodifai-http sul locale ${config.localMcpUrl}. HTTPS pubblico apre al lancio.`,
              statusBadge: "HTTPS remoto disponibile al lancio",
              copyText: "gemini mcp add -s user mellodifai mellodifai mcp",
              copyLabel: "Copia comando stdio Gemini",
              copyKind: "cli",
            },
          ],
      mockChat: {
        clientLabel: "Gemini CLI",
        userPrompt:
          "Elenca i rifacimenti in revisione e rigenera solo il ritornello del rifacimento 4b12.",
        toolName: "remakes_list -> remake_regenerate_section",
        toolMeta: "permessi read + spend, conferma richiesta",
        assistantReply:
          "Trovato 1 rifacimento in revisione. Dopo la tua conferma ho avviato la rigenerazione del ritornello con job 9f2a.",
      },
      faqClientAnswer: remoteUrl
        ? `Gemini CLI registra MellodifAI con due nomi distinti in ~/.gemini/settings.json: mellodifai-http per HTTP (${remoteUrl}) e mellodifai per il ponte stdio mellodifai mcp, con trust disattivato.`
        : `Gemini CLI si collega oggi con il ponte stdio locale mellodifai mcp (nome server mellodifai) o via HTTP locale su ${config.localMcpUrl} (nome mellodifai-http), con trust disattivato. HTTPS pubblico apre al lancio.`,
    },
    codex: {
      id: "codex",
      name: "Codex",
      transportBadge: remoteUrl ? "Codex CLI + MCP" : "Codex CLI MCP locale",
      heroLineA: "Automatizza i brani con",
      heroLineB: "Codex",
      heroLede:
        "Installa la CLI MellodifAI dal repository, accedi via stdin e registra mellodifai in ~/.codex/config.toml per eseguire riscritture, stem e bozze dal terminale.",
      primaryCtaLabel: "Collega Codex",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Installa la CLI dal repository",
          line: `@mellodifai/cli non e ancora su npm. Impacchetta e installa il binario dal repository (server locale: ${config.localSiteOrigin}).`,
          docHref: config.repoDocsUrl,
          docLabel: localDocLabel,
          copyText: CLI_INSTALL_COMMAND,
          copyLabel: "Copia comando installazione CLI",
          copyKind: "cli",
        },
        {
          title: "Accedi passando il token da stdin",
          line: "Crea un token personale in Impostazioni -> Agenti e invia MELLODIFAI_PAT tramite pipe a mellodifai login senza mai scrivere segreti negli argomenti.",
          copyText: loginCommand,
          copyLabel: "Copia comando login CLI",
          copyKind: "cli",
        },
        {
          title: "Aggiungi MellodifAI a Codex CLI",
          line: "Registra il ponte stdio cosi Codex scrive [mcp_servers.mellodifai] in ~/.codex/config.toml, poi verifica gli schemi con mellodifai tools o codex mcp list.",
          copyText: "codex mcp add mellodifai -- mellodifai mcp",
          copyLabel: "Copia comando Codex",
          copyKind: "cli",
        },
      ],
      mockChat: {
        clientLabel: "Codex CLI",
        userPrompt:
          "Separa gli stem voce e base del mio brano approvato e segui job_status fino al termine.",
        toolName: "stems_request -> job_status",
        toolMeta: "permessi create + read, idempotency_key gestita dalla CLI",
        assistantReply:
          "Separazione stem completata. Le tracce voce e base sono pronte nella scheda song_get.",
      },
      faqClientAnswer: remoteUrl
        ? `Codex CLI si collega con codex mcp add mellodifai -- mellodifai mcp (in ~/.codex/config.toml) oppure in HTTP su ${remoteUrl} usando bearer_token_env_var.`
        : `Codex CLI si collega oggi con codex mcp add mellodifai -- mellodifai mcp dopo aver installato @mellodifai/cli dal repository ed eseguito mellodifai login --url ${config.localSiteOrigin} via stdin (MCP locale: ${config.localMcpUrl}).`,
    },
    cursor: {
      id: "cursor",
      name: "Cursor",
      transportBadge: remoteUrl
        ? "Cursor mcp.json"
        : "Cursor mcp.json locale (remoto al lancio)",
      heroLineA: "Lavora ai brani dentro",
      heroLineB: "Cursor",
      heroLede: remoteUrl
        ? "Configura .cursor/mcp.json con il nostro URL Streamable HTTP o il ponte locale mellodifai mcp. Tieni i token in variabili d'ambiente, mai nei file."
        : "Configura .cursor/mcp.json con il ponte locale mellodifai mcp o l'endpoint locale oggi. L'indirizzo HTTPS pubblico si attiva al lancio.",
      primaryCtaLabel: "Collega Cursor",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: remoteUrl
        ? [
            {
              title: "Configura .cursor/mcp.json",
              line: `Aggiungi mellodifai-http in .cursor/mcp.json o ~/.cursor/mcp.json puntando al nostro indirizzo Streamable HTTP con ${CURSOR_ENV_VAR}.`,
              copyText: remoteUrl,
              copyLabel: "Copia indirizzo MCP",
              copyKind: "mcp-url",
            },
            {
              title: "Oppure installa CLI e accedi da stdin",
              line: "Preferisci stdio? Installa @mellodifai/cli dal repository e invia MELLODIFAI_PAT tramite pipe a mellodifai login.",
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: loginCommand,
              copyLabel: "Copia comando login CLI",
              copyKind: "cli",
            },
            {
              title: "Avvia il ponte stdio locale",
              line: 'Imposta command su mellodifai e args su ["mcp"] in .cursor/mcp.json, poi esegui /mcp list dentro Cursor Agent.',
              copyText: "mellodifai mcp",
              copyLabel: "Copia comando stdio",
              copyKind: "cli",
            },
          ]
        : [
            {
              title: "Installa la CLI dal repository",
              line: `@mellodifai/cli non e ancora su npm. Impacchetta e installa il binario dal repository mentre MellodifAI gira in locale su ${config.localSiteOrigin}.`,
              docHref: config.repoDocsUrl,
              docLabel: localDocLabel,
              copyText: CLI_INSTALL_COMMAND,
              copyLabel: "Copia comando installazione CLI",
              copyKind: "cli",
            },
            {
              title: "Accedi passando il PAT da stdin",
              line: "Crea un token personale in Impostazioni -> Agenti sul server locale e invia MELLODIFAI_PAT tramite pipe a mellodifai login.",
              copyText: loginCommand,
              copyLabel: "Copia comando login CLI",
              copyKind: "cli",
            },
            {
              title: "Aggiungi mellodifai a .cursor/mcp.json",
              line: `Imposta command su mellodifai e args su ["mcp"] (o punta mellodifai-http al locale ${config.localMcpUrl}). HTTPS pubblico apre al lancio.`,
              statusBadge: "HTTPS remoto disponibile al lancio",
              copyText: "mellodifai mcp",
              copyLabel: "Copia comando stdio",
              copyKind: "cli",
            },
          ],
      mockChat: {
        clientLabel: "Cursor",
        userPrompt:
          "Crea il piano storyboard gratuito per il brano 7c18 e stima la scena 2 senza spendere crediti.",
        toolName: "music_video_plan_request -> music_video_take_request",
        toolMeta: "permesso create, spesa zero",
        assistantReply:
          "Piano storyboard pronto con 8 inquadrature. Il preventivo della scena 2 e salvato per la tua revisione in app.",
      },
      faqClientAnswer: remoteUrl
        ? `Cursor legge .cursor/mcp.json o ~/.cursor/mcp.json con l'indirizzo remoto ${remoteUrl} (voce mellodifai-http) oppure con il comando locale mellodifai mcp.`
        : `Cursor si collega oggi via .cursor/mcp.json con il comando locale mellodifai mcp (dopo installazione CLI dal repository e login da stdin) o via HTTP locale su ${config.localMcpUrl}. HTTPS pubblico apre al lancio.`,
    },
  };
}

export function getAllAgentProfiles(
  lang: SiteLang,
  config: AgentsLaunchConfig = DEFAULT_AGENTS_LAUNCH_CONFIG,
): Record<AgentName, AgentProfile> {
  return lang === "it" ? buildProfilesIt(config) : buildProfilesEn(config);
}

export function getAgentProfile(
  agent: AgentName,
  lang: SiteLang,
  config: AgentsLaunchConfig = DEFAULT_AGENTS_LAUNCH_CONFIG,
): AgentProfile {
  return getAllAgentProfiles(lang, config)[agent];
}

/**
 * Extracts every `mellodifai <subcommand>` invoked in a shell command snippet.
 * Used by unit and e2e tests to verify every copied CLI command exists in packages/cli.
 */
export function extractCliCommands(text: string): string[] {
  const found: string[] = [];
  const re = /(?:^|[;&|]\s*|--\s+)mellodifai\s+([a-z][a-z0-9-]*)(?!:\/\/)\b/gmu;
  for (const match of text.matchAll(re)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

/**
 * Extracts every http(s)://... URL mentioned in a copied snippet.
 */
export function extractAllUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s"'`]+/gu) ?? [];
}

/**
 * Extracts every http(s)://.../api/mcp URL mentioned in a copied snippet.
 */
export function extractMcpUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s"'`]+\/api\/mcp\b/gu) ?? [];
}

// Secret-like patterns forbidden in any copied text shown on the public site.
const FORBIDDEN_SECRET_PATTERNS: readonly RegExp[] = [
  /\bmdf_pat_[A-Za-z0-9_-]+/u,
  /\bsk-[A-Za-z0-9_-]{12,}/u,
  /Bearer\s+[A-Za-z0-9._-]{12,}/u,
  /\b[A-Za-z0-9_]*(?:api[_-]?key|secret|password|token)\s*=\s*['"]?[A-Za-z0-9._-]{3,}/iu,
];

export function hasForbiddenSecret(text: string): boolean {
  return FORBIDDEN_SECRET_PATTERNS.some((re) => re.test(text));
}
