# /claude-design — Generate a design via the browser MCP

**Prerequisite:** the `cursor-ide-browser` MCP is enabled in this session, the
user has a paid Claude account, and `npx claude-design-cursor-bridge init` has
already been run in this project.

## Agent Instructions

1. Read `.cursor/skills/claude-design-browser/SKILL.md` and follow it end to
   end. Do not skip the failure-mode rules.
2. The user message after `/claude-design` is the **prompt** to send to Claude
   Design. If the message contains an explicit `slug:` or `route:` line,
   forward those as the slug and target route.
3. After the bundle is ingested, hand off to
   `.cursor/skills/import-claude-design/SKILL.md` from its Step 2.

## Notes

- First run requires a manual login in the locked browser tab.
- For >2 refinement cycles, switch to claude.ai/design manually — the
  tool-call loop is too slow for visual iteration.
- Do not run this in CI.
