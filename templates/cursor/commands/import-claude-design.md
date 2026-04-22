# /import-claude-design — Consume a Claude Design handoff bundle

**Prerequisite:** A `.zip` exported from claude.ai/design ("Export → .zip"),
either at a path the user provides or already under `.design/handoff/`.

## Agent Instructions

1. Read `.cursor/skills/import-claude-design/SKILL.md` and follow it end to
   end.
2. If the user gave a `.zip` path, run:
   ```bash
   node scripts/ingest-claude-design.mjs <path-to-zip> [--slug <slug>]
   ```
3. Implement against the project's frontend per the skill (token
   reconciliation first, then components, then assets, then interactions).

## Notes

- Cursor cannot use "Send to Claude Code Web". Always require a local bundle.
- For live UI in the other direction, use Claude Design's web capture against
  the running dev server.
