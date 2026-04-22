# `.design/handoff/`

Staging area for **Claude Design** handoff bundles consumed by Cursor.
Installed by `claude-design-cursor-bridge`.

## Contract

- One subdirectory per imported design, named `<slug>/`.
- Each subdirectory is the unpacked content of a `.zip` exported from
  claude.ai/design via "Export → .zip".
- Tracked in git: `manifest.json`, `spec.json`, `design-tokens.json`,
  `README.md`, `components/**` (specs, not assets).
- Ignored in git: `*.zip`, `assets/**`, `preview/**`.

## Workflow

### Browser-driven (preferred)

In Cursor, in the agent chat:

```
/claude-design   <followed by your design prompt>
```

The agent drives claude.ai/design via the cursor-ide-browser MCP, exports
the `.zip`, ingests it here, then hands off to the import skill.

### Manual

1. In claude.ai/design: **Export → .zip** (do not pick "Standalone HTML").
2. Drop the `.zip` anywhere; pass an absolute path:
   ```bash
   node scripts/ingest-claude-design.mjs <path-to-zip> [--slug <slug>]
   ```
3. In Cursor: invoke `/import-claude-design` or ask the agent to follow
   `.cursor/skills/import-claude-design/SKILL.md`.

### Auto-watch (optional)

Run from a terminal once:

```bash
npx claude-design-cursor-bridge watch .
```

Any `claude-design-*.zip` that lands in `~/Downloads` gets ingested
automatically.

## Why not "Send to Claude Code Web" from Cursor?

That endpoint is gated to the Claude Code agent. Cursor does not have access.
The `.zip` export is the supported, agent-agnostic equivalent and contains
the same machine-readable spec Anthropic ships to Claude Code.
