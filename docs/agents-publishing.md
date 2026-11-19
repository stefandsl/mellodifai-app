# Publishing with agents ("Pubblica")

Status: YouTube only (owner decision, 19 Nov 2026). The other platforms show as "Presto" in the
dashboard; they plug in later behind the same `PublishingProvider` interface
(`packages/shared/src/publishing/provider.ts`). Design: `research/2026-11-19/publishing-design.md`.

## The rules an agent cannot change

- An agent prepares and asks. Only the owner approves, in the app (dashboard "Pubblica" or
  Settings > Pubblicazione). There is no approval tool, route or CLI command for tokens.
- A standing rule the owner wrote (Settings > Pubblicazione) can approve by itself: same platform,
  the plan's real price within the rule's cap (the native YouTube route costs 0; a provider
  without a known price is never covered), and a slot that leaves at least the rule's veto window.
  After a veto or a rejection of a plan for a video, no rule approves that video again: the owner's
  card decides until the owner approves one. A rule's yes holds only while the rule still exists
  and is active when the slot comes.
- The video goes up **private** after the yes and becomes public only at the slot, by the app's
  own clock (never YouTube `publishAt`). Right before that, the worker pushes the approved title,
  description, tags and thumbnail text to the video (`publish/yt.py update`); if YouTube refuses,
  the video stays private and the plan shows `metadata_update_failed`.
- The veto stays open until the provider handoff starts, also after a delayed slot. Any token with
  scope `create` may veto; after the handoff a veto answers `conflict`.
- Any edit of the title, description, tags, thumbnail text or slot cancels a pending approval card.
- Fail closed: a missed slot (worker off for more than 6 hours), a changed payload, an unknown
  provider answer or a refused upload leaves the video private and tells the owner.
- Old flow: a video that the earlier publish flow already scheduled with a YouTube `publishAt`
  (publication privacy `scheduled`) or made public cannot get a plan (`publish_plan` answers
  `conflict`). YouTube's own clock publishes it. `publish_status` lists those uploads read-only in
  `legacy` (`video_id`, `privacy`, `publish_at`) and the dashboard shows them; change them in
  YouTube Studio. The worker reads a private video with a `publishAt` as scheduled by YouTube,
  never as "not accepted", so it never retries or flips it.

## Workflow

| Step | MCP tool | HTTP | CLI | Scope |
| --- | --- | --- | --- | --- |
| 1. Plan a private draft | `publish_plan` | `POST /api/v1/publish/plans` | `mellodifai publish-plan <version_id> [--input plan.json]` | create |
| 2. Check it | `publish_preview` | `GET /api/v1/publish/{schedule_id}` | `mellodifai publish-preview <schedule_id>` | read |
| 3. Fix problems | `publish_draft_edit` | `POST /api/v1/publish/{schedule_id}/draft` | `mellodifai publish-edit <schedule_id> --input draft.json` | create |
| 4. Set the slot | `publish_schedule` | `POST /api/v1/publish/{schedule_id}/schedule` | `mellodifai publish-schedule <schedule_id> <ISO date>` | create |
| 5. Ask for approval | `publish_request_approval` | `POST /api/v1/publish/{schedule_id}/request-approval` | `mellodifai publish-request <schedule_id>` | spend |
| Follow | `publish_status` | `GET /api/v1/songs/{version_id}/publish` | `mellodifai publish-status <version_id>` | read |
| Stop | `publish_veto` | `POST /api/v1/publish/{schedule_id}/veto` | `mellodifai publish-veto <schedule_id>` | create |
| Remove | `publish_cancel` | `POST /api/v1/publish/{schedule_id}/cancel` | `mellodifai publish-cancel <schedule_id>` | create |

Every write needs an `idempotency_key` (MCP argument, `Idempotency-Key` header, or the CLI's
generated key). Keep the same key to repeat the same request.

The draft has four fields: `title` (1-100 characters, no `<` or `>`), `description` (at most 5000),
`tags` (at most 500 characters as YouTube counts them) and `thumbnail_text` (at most 60). The answer
of every tool is the plan: `state`, `slot_at`, `veto_deadline_at`, `veto_open`, `approval`
(the card: `summary`, `price_eur`, `state`), `destinations[].problems`, `media` (the private
upload) and `events` (history).

States: `draft`, `awaiting_approval`, `scheduled` (veto open), `publishing`, `published`,
`held` (needs the owner: `held_reason` is `missed_slot`, `gate_failed` or `status_unknown`),
`failed`, `vetoed`, `cancelled`, `rejected`, `expired`.

When `publish_request_approval` answers `awaiting_approval`: show the card to the person and stop.
Never retry, never create another token, never ask anyone else to approve. The MCP prompt
`publish_video` carries this workflow.

## Connect your agent

The studio has two transports: the stdio bridge `mellodifai mcp` (the CLI, with the PAT stored by
`mellodifai login`) and Streamable HTTP at `<origin>/api/mcp` (Bearer PAT, or OAuth for remote
clients). `MELLODIFAI_PAT` is an environment variable you set; never paste the token itself into a
config file. On the owner's PC, set `APPDATA` to the private profile on E: for the CLI process
(`packages/cli/skill/SKILL.md`). Snippets follow each vendor's docs as read on 2026-11-19.

### Claude Code

```bash
# stdio
claude mcp add mellodifai -- mellodifai mcp
# HTTP, user scope
claude mcp add --transport http --scope user mellodifai https://<origin>/api/mcp --header "Authorization: Bearer ${MELLODIFAI_PAT}"
```

Project file `.mcp.json` (supports `${VAR}` expansion):

```json
{ "mcpServers": { "mellodifai": { "type": "http", "url": "https://<origin>/api/mcp", "headers": { "Authorization": "Bearer ${MELLODIFAI_PAT}" } } } }
```

### Codex CLI

`~/.codex/config.toml` or `.codex/config.toml`:

```bash
codex mcp add mellodifai -- mellodifai mcp
```

```toml
[mcp_servers.mellodifai]
command = "mellodifai"
args = ["mcp"]

# or HTTP
[mcp_servers.mellodifai_http]
url = "https://<origin>/api/mcp"
bearer_token_env_var = "MELLODIFAI_PAT"
```

### Gemini CLI

`~/.gemini/settings.json` or `.gemini/settings.json`:

```bash
gemini mcp add -s user mellodifai mellodifai mcp
gemini mcp add -s user --transport http mellodifai-http https://<origin>/api/mcp
```

```json
{ "mcpServers": {
  "mellodifai": { "command": "mellodifai", "args": ["mcp"], "trust": false },
  "mellodifai-http": { "httpUrl": "https://<origin>/api/mcp", "headers": { "Authorization": "Bearer $MELLODIFAI_PAT" } }
} }
```

Keep `trust: false` (no `--trust`): `--trust` bypasses every tool-call confirmation.

### Cursor

`.cursor/mcp.json` or `~/.cursor/mcp.json` (`${env:NAME}` interpolation):

```json
{ "mcpServers": {
  "mellodifai": { "command": "mellodifai", "args": ["mcp"] },
  "mellodifai-http": { "url": "https://<origin>/api/mcp", "headers": { "Authorization": "Bearer ${env:MELLODIFAI_PAT}" } }
} }
```

Client-side confirmation is not a safety control we rely on: every client can auto-approve tools.
Public actions are gated on the server (approval card, standing rules, veto window).

## For developers

- Database: migration `supabase/migrations/20261119000001_publish_dashboard.sql`, tests
  `supabase/tests/publish_dashboard.test.ts`. Lock order everywhere: the `publish_schedules` row,
  then its `publish_destinations` rows by id.
- Worker: `apps/worker/src/publishing/dispatcher.ts` (claim, intent, handoff, post, finish,
  recovery) and `youtube.ts` (the provider over `publish/yt.py`; `FakeYouTubeClient` with
  `WORKER_FAKE=1`). The private upload is the existing `publish` stage.
- Web: `/projects/<id>/publish?lang=<xx>` and `/settings/publishing`; ops definitions in
  `apps/web/lib/ops/defs/publishing.ts`.
- The title and thumbnail pairing lint (`packages/shared/src/publishing/lint.ts`) follows an idea
  of youtube-agent-skill (MIT); no text of that project is copied.
