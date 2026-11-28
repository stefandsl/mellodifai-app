# Agent access: HTTP API, OAuth, MCP server, and mellodifai CLI

Shipped the first end-to-end agent integration stack: versioned HTTP API, OAuth authorization server, remote MCP server, Settings Agenti, and the CLI bridge.

## What changed

- Added bearer tokens, idempotency keys, rate limits, and the versioned HTTP API for M1 studio operations.
- Built the OIDC authorization server, browser-bound consent page, and Settings Agenti UI for tokens, pairing, and remote access toggles.
- Exposed the remote MCP server authenticated with scoped agent tokens and OAuth metadata.
- Shipped the `mellodifai` CLI with a stdio MCP bridge and bundled agent skill.
