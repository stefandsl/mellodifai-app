# Agent remake access over API, MCP, and CLI

Agents can now inspect and drive the Rifai da YouTube remake workflow through the versioned HTTP API, MCP server, and `mellodifai` CLI.

## What changed

- Exposed remake reads and scoped remake operations to agent tokens over the HTTP API, MCP server, and CLI.
- Added remake commands and a generic tool call entry point to the `mellodifai` CLI.
- Kept source lyrics out of agent read responses and tracked analysis costs and receipts per remake across retries.
- Configured production SMTP secret loading and hardened worker audio download guards, transcription JSON handling, and interrupted MCP read classification.
