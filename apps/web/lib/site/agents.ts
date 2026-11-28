// Build-time and server-safe data model for the /agents page (C08).
// Single source of truth: the MCP tool list is read directly from TOKEN_OPS in
// apps/web/lib/ops/registry.ts (the same array registered by buildMcpServer).
// Canonical origin and MCP resource path come from ops/lib/auth-origins.ts.

import { TOKEN_OPS, type TokenOp } from "@/lib/ops/registry";
import { AUTH_ORIGINS, mcpResource } from "../../../../ops/lib/auth-origins";
import type { SiteLang } from "./copy";
import { AGENTS, type AgentName, DEFAULT_AGENT, parseAgentParam } from "./nav";

export { AGENTS, type AgentName, DEFAULT_AGENT, parseAgentParam };

export const CANONICAL_SITE_ORIGIN = AUTH_ORIGINS.prod.siteUrl;
export const CANONICAL_MCP_URL = mcpResource(CANONICAL_SITE_ORIGIN);
export const CANONICAL_MCP_PATH = new URL(CANONICAL_MCP_URL).pathname;
export const CANONICAL_MCP_METADATA_PATH = `/.well-known/oauth-protected-resource${CANONICAL_MCP_PATH}`;

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

// Verified against docs/agents-publishing.md, packages/cli/src/commands.ts,
// and official client MCP setup guides. Zero secrets or tokens appear in any command.
const AGENT_PROFILES: Record<SiteLang, Record<AgentName, AgentProfile>> = {
  en: {
    claude: {
      id: "claude",
      name: "Claude",
      transportBadge: "Remote MCP or CLI bridge",
      heroLineA: "Edit songs right inside",
      heroLineB: "Claude",
      heroLede:
        "Connect Claude to MellodifAI over Streamable HTTP MCP or the local CLI bridge. Inspect tracks, rewrite verses, pick takes, and prepare releases.",
      primaryCtaLabel: "Connect Claude",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Add the MellodifAI connector",
          line: "In Claude Settings -> Connectors, add a custom connector with our remote MCP address, or register it in Claude Code.",
          copyText: CANONICAL_MCP_URL,
          copyLabel: "Copy MCP address",
          copyKind: "mcp-url",
        },
        {
          title: "Sign in or pair the CLI bridge",
          line: "Approve the OAuth scopes in MellodifAI when Claude connects, or add the local stdio bridge in Claude Code after mellodifai login.",
          copyText: "claude mcp add mellodifai -- mellodifai mcp",
          copyLabel: "Copy Claude Code command",
          copyKind: "cli",
        },
        {
          title: "Ask Claude to work on a song",
          line: "Start a chat and ask Claude to list songs, start a YouTube remake, or draft a lyric change while spend caps stay active.",
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
      faqClientAnswer:
        "Claude connects over Streamable HTTP MCP in Settings -> Connectors using OAuth, or through Claude Code with claude mcp add mellodifai -- mellodifai mcp.",
    },
    chatgpt: {
      id: "chatgpt",
      name: "ChatGPT",
      transportBadge: "Remote MCP + OAuth",
      heroLineA: "Shape every take inside",
      heroLineB: "ChatGPT",
      heroLede:
        "Attach MellodifAI as a custom MCP connector in ChatGPT. Review songs, rewrite lines, request stems, and queue private YouTube drafts.",
      primaryCtaLabel: "Connect ChatGPT",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Add a custom MCP server",
          line: "Open ChatGPT Settings -> Connectors (turn on Developer Mode if your workspace requires it) and paste our HTTPS MCP address with OAuth.",
          copyText: CANONICAL_MCP_URL,
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
      faqClientAnswer:
        "ChatGPT connects through a custom MCP server in Settings -> Connectors (with Developer Mode enabled on eligible plans) using https://app.mellodifai.com/api/mcp and OAuth.",
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      transportBadge: "Gemini CLI MCP",
      heroLineA: "Drive your studio from",
      heroLineB: "Gemini",
      heroLede:
        "Register MellodifAI in Gemini CLI over Streamable HTTP or the local stdio bridge. Keep trust disabled so every write asks before running.",
      primaryCtaLabel: "Connect Gemini",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Register the remote MCP server",
          line: "Add MellodifAI to ~/.gemini/settings.json using Gemini CLI's HTTP transport command (keep trust set to false).",
          copyText: `gemini mcp add -s user --transport http mellodifai ${CANONICAL_MCP_URL}`,
          copyLabel: "Copy Gemini HTTP command",
          copyKind: "mcp-url",
        },
        {
          title: "Or connect the local CLI bridge",
          line: "Prefer local credentials from mellodifai login? Register the stdio bridge command so the CLI forwards JSON-RPC with idempotency keys.",
          copyText: "gemini mcp add -s user mellodifai mellodifai mcp",
          copyLabel: "Copy Gemini stdio command",
          copyKind: "cli",
        },
        {
          title: "Verify tools with /mcp list",
          line: "Start Gemini CLI, run /mcp list to confirm MellodifAI's tools are loaded, and ask it to check costs or start a remake.",
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
      faqClientAnswer:
        "Gemini CLI registers MellodifAI via gemini mcp add --transport http or the local mellodifai mcp stdio bridge in ~/.gemini/settings.json, with trust kept off.",
    },
    codex: {
      id: "codex",
      name: "Codex",
      transportBadge: "Codex CLI + MCP",
      heroLineA: "Automate song edits with",
      heroLineB: "Codex",
      heroLede:
        "Add MellodifAI to ~/.codex/config.toml via codex mcp add. Run audited lyric rewrites, stem splits, and release plans from your terminal.",
      primaryCtaLabel: "Connect Codex",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Add MellodifAI to Codex CLI",
          line: "Register the local stdio MCP server so Codex writes [mcp_servers.mellodifai] into ~/.codex/config.toml.",
          copyText: "codex mcp add mellodifai -- mellodifai mcp",
          copyLabel: "Copy Codex command",
          copyKind: "cli",
        },
        {
          title: "Authenticate via CLI stdin",
          line: "Create a personal token in Settings -> Agents and pipe it via stdin to mellodifai login without placing any secret in arguments or config files.",
          copyText: `mellodifai login --url ${CANONICAL_SITE_ORIGIN}`,
          copyLabel: "Copy CLI login command",
          copyKind: "cli",
        },
        {
          title: "Check tools and prompt Codex",
          line: "Run codex mcp list or mellodifai tools to verify every tool schema, then ask Codex to inspect jobs, request stems, or schedule a draft.",
          copyText: "mellodifai tools",
          copyLabel: "Copy tools command",
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
      faqClientAnswer:
        "Codex CLI connects through codex mcp add mellodifai -- mellodifai mcp (writing [mcp_servers.mellodifai] to ~/.codex/config.toml) or via HTTP with bearer_token_env_var.",
    },
    cursor: {
      id: "cursor",
      name: "Cursor",
      transportBadge: "Cursor mcp.json",
      heroLineA: "Work on tracks inside",
      heroLineB: "Cursor",
      heroLede:
        "Configure .cursor/mcp.json with our Streamable HTTP URL or local mellodifai mcp bridge. Keep credentials in environment variables, never in files.",
      primaryCtaLabel: "Connect Cursor",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Open Agent Settings",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Point .cursor/mcp.json at MellodifAI",
          line: "Add a mellodifai entry in .cursor/mcp.json or ~/.cursor/mcp.json using our Streamable HTTP MCP URL and env-var header interpolation.",
          copyText: CANONICAL_MCP_URL,
          copyLabel: "Copy MCP address",
          copyKind: "mcp-url",
        },
        {
          title: "Or run the local CLI bridge",
          line: 'For stdio in Cursor, set command to mellodifai and args to ["mcp"] after signing in locally with mellodifai login.',
          copyText: "mellodifai mcp",
          copyLabel: "Copy stdio command",
          copyKind: "cli",
        },
        {
          title: "Inspect tools in Cursor Agent",
          line: "Run /mcp list inside Cursor Agent to confirm the server is connected, then ask it to draft a music-video storyboard or publish plan.",
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
      faqClientAnswer:
        "Cursor reads .cursor/mcp.json or ~/.cursor/mcp.json with either the remote URL https://app.mellodifai.com/api/mcp or the local command mellodifai mcp.",
    },
  },
  it: {
    claude: {
      id: "claude",
      name: "Claude",
      transportBadge: "MCP remoto o ponte CLI",
      heroLineA: "Modifica i brani dentro",
      heroLineB: "Claude",
      heroLede:
        "Collega Claude a MellodifAI via Streamable HTTP MCP o con il ponte CLI locale. Controlla i brani, riscrivi strofe, scegli take e prepara bozze.",
      primaryCtaLabel: "Collega Claude",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Aggiungi il connettore MellodifAI",
          line: "In Claude Impostazioni -> Connettori aggiungi un connettore personalizzato con l'indirizzo MCP remoto, oppure registralo in Claude Code.",
          copyText: CANONICAL_MCP_URL,
          copyLabel: "Copia indirizzo MCP",
          copyKind: "mcp-url",
        },
        {
          title: "Accedi o collega il ponte CLI",
          line: "Approva i permessi OAuth su MellodifAI quando Claude si collega, oppure registra il ponte stdio in Claude Code dopo mellodifai login.",
          copyText: "claude mcp add mellodifai -- mellodifai mcp",
          copyLabel: "Copia comando Claude Code",
          copyKind: "cli",
        },
        {
          title: "Chiedi a Claude di lavorare sul brano",
          line: "Apri una chat e chiedi di elencare i brani, avviare un rifacimento da YouTube o rifinire un verso con i limiti di spesa sempre attivi.",
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
      faqClientAnswer:
        "Claude si collega via Streamable HTTP MCP da Impostazioni -> Connettori con OAuth, oppure da Claude Code con claude mcp add mellodifai -- mellodifai mcp.",
    },
    chatgpt: {
      id: "chatgpt",
      name: "ChatGPT",
      transportBadge: "MCP remoto + OAuth",
      heroLineA: "Rifinisci ogni take in",
      heroLineB: "ChatGPT",
      heroLede:
        "Collega MellodifAI come connettore MCP personalizzato in ChatGPT. Controlla brani, riscrivi versi, separa gli stem e prepara bozze YouTube private.",
      primaryCtaLabel: "Collega ChatGPT",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Aggiungi un server MCP personalizzato",
          line: "Apri ChatGPT Impostazioni -> Connettori (attiva Developer Mode se richiesto dal tuo piano) e incolla l'indirizzo MCP HTTPS con OAuth.",
          copyText: CANONICAL_MCP_URL,
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
      faqClientAnswer:
        "ChatGPT si collega tramite server MCP personalizzato in Impostazioni -> Connettori (con Developer Mode attivo sui piani supportati) usando https://app.mellodifai.com/api/mcp e OAuth.",
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      transportBadge: "Gemini CLI MCP",
      heroLineA: "Guida lo studio da",
      heroLineB: "Gemini",
      heroLede:
        "Registra MellodifAI in Gemini CLI via Streamable HTTP o con il ponte stdio locale. Mantieni trust disattivato per confermare ogni scrittura.",
      primaryCtaLabel: "Collega Gemini",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Registra il server MCP remoto",
          line: "Aggiungi MellodifAI in ~/.gemini/settings.json con il comando HTTP di Gemini CLI (senza --trust).",
          copyText: `gemini mcp add -s user --transport http mellodifai ${CANONICAL_MCP_URL}`,
          copyLabel: "Copia comando HTTP Gemini",
          copyKind: "mcp-url",
        },
        {
          title: "Oppure usa il ponte CLI locale",
          line: "Preferisci le credenziali locali salvate con mellodifai login? Registra il ponte stdio che invia JSON-RPC con chiavi di idempotenza.",
          copyText: "gemini mcp add -s user mellodifai mellodifai mcp",
          copyLabel: "Copia comando stdio Gemini",
          copyKind: "cli",
        },
        {
          title: "Verifica gli strumenti con /mcp list",
          line: "Avvia Gemini CLI, esegui /mcp list per controllare gli strumenti caricati e chiedi i costi o un nuovo rifacimento.",
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
      faqClientAnswer:
        "Gemini CLI registra MellodifAI con gemini mcp add --transport http oppure con il ponte locale mellodifai mcp in ~/.gemini/settings.json, mantenendo trust disattivato.",
    },
    codex: {
      id: "codex",
      name: "Codex",
      transportBadge: "Codex CLI + MCP",
      heroLineA: "Automatizza i brani con",
      heroLineB: "Codex",
      heroLede:
        "Aggiungi MellodifAI a ~/.codex/config.toml con codex mcp add. Esegui riscritture controllate, separazione stem e bozze dal terminale.",
      primaryCtaLabel: "Collega Codex",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Aggiungi MellodifAI a Codex CLI",
          line: "Registra il server MCP stdio locale cosi Codex scrive [mcp_servers.mellodifai] dentro ~/.codex/config.toml.",
          copyText: "codex mcp add mellodifai -- mellodifai mcp",
          copyLabel: "Copia comando Codex",
          copyKind: "cli",
        },
        {
          title: "Accedi passando il token da stdin",
          line: "Crea un token personale in Impostazioni -> Agenti e invialo da stdin a mellodifai login senza mai scrivere segreti negli argomenti.",
          copyText: `mellodifai login --url ${CANONICAL_SITE_ORIGIN}`,
          copyLabel: "Copia comando login CLI",
          copyKind: "cli",
        },
        {
          title: "Controlla gli strumenti e avvia Codex",
          line: "Esegui codex mcp list o mellodifai tools per verificare gli schemi reali, poi chiedi a Codex di seguire un job o separare gli stem.",
          copyText: "mellodifai tools",
          copyLabel: "Copia comando tools",
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
      faqClientAnswer:
        "Codex CLI si collega con codex mcp add mellodifai -- mellodifai mcp (in ~/.codex/config.toml) oppure in HTTP usando bearer_token_env_var.",
    },
    cursor: {
      id: "cursor",
      name: "Cursor",
      transportBadge: "Cursor mcp.json",
      heroLineA: "Lavora ai brani dentro",
      heroLineB: "Cursor",
      heroLede:
        "Configura .cursor/mcp.json con il nostro URL Streamable HTTP o il ponte locale mellodifai mcp. Tieni i token in variabili d'ambiente, mai nei file.",
      primaryCtaLabel: "Collega Cursor",
      primaryCtaHref: SETTINGS_AGENTS_HREF,
      connectCtaLabel: "Apri Impostazioni Agenti",
      connectCtaHref: SETTINGS_AGENTS_HREF,
      connectSteps: [
        {
          title: "Configura .cursor/mcp.json",
          line: "Aggiungi mellodifai in .cursor/mcp.json o ~/.cursor/mcp.json puntando al nostro indirizzo Streamable HTTP con variabile d'ambiente.",
          copyText: CANONICAL_MCP_URL,
          copyLabel: "Copia indirizzo MCP",
          copyKind: "mcp-url",
        },
        {
          title: "Oppure usa il ponte CLI locale",
          line: 'Per stdio in Cursor imposta command su mellodifai e args su ["mcp"] dopo aver eseguito mellodifai login in locale.',
          copyText: "mellodifai mcp",
          copyLabel: "Copia comando stdio",
          copyKind: "cli",
        },
        {
          title: "Verifica gli strumenti in Cursor Agent",
          line: "Esegui /mcp list in Cursor Agent per controllare la connessione, poi chiedi uno storyboard video o una bozza YouTube.",
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
      faqClientAnswer:
        "Cursor legge .cursor/mcp.json o ~/.cursor/mcp.json con l'indirizzo remoto https://app.mellodifai.com/api/mcp oppure con il comando locale mellodifai mcp.",
    },
  },
};

export function getAgentProfile(
  agent: AgentName,
  lang: SiteLang,
): AgentProfile {
  return AGENT_PROFILES[lang][agent];
}

export function getAllAgentProfiles(
  lang: SiteLang,
): Record<AgentName, AgentProfile> {
  return AGENT_PROFILES[lang];
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
 * Extracts every https://.../api/mcp URL mentioned in a copied snippet.
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
