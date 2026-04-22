---
name: import-claude-design
description: Consume a Claude Design handoff bundle (.zip exported from claude.ai/design) and implement it against this project's frontend. Use when the user provides a Claude Design export, paste link, or asks to "build this design" with a bundle path.
---

# Import Claude Design — Skill

Claude Design exports a handoff bundle that Claude Code consumes natively.
Cursor consumes the same bundle by reading its files as context. There is no
"Send to Cursor" button. The supported entry points are:

1. `.zip` export from claude.ai/design ("Export → .zip").
2. The `claude-design-browser` skill in this same project, which automates
   steps 1–7 of the export flow inside Cursor.

Cursor cannot replicate "Send to Claude Code Web" — that endpoint is gated to
the Claude Code agent. Always require a local bundle.

## Project conventions for this install

The bridge installer (`cdc init`) detected the following layout. Honor these
paths during implementation. If a path no longer exists, stop and ask the user
to re-run `cdc init` or pass overrides.

| Aspect              | Path / command                |
|---------------------|-------------------------------|
| Framework           | `{{framework}}`               |
| Components dir      | `{{components_dir}}`          |
| Pages / routes      | `{{pages_dir}}`               |
| Services / API      | `{{services_dir}}`            |
| i18n                | `{{i18n_dir}}`                |
| Tokens / global CSS | `{{tokens_file}}`             |
| Lint                | `{{lint_cmd}}`                |
| Build               | `{{build_cmd}}`               |
| Dev server          | `{{dev_cmd}}`                 |

## Inputs the agent expects

A bundle directory under `.design/handoff/<slug>/` containing:

```
.design/handoff/<slug>/
  README.md                  # written by Claude Design, instructions for the coding agent
  spec.json                  # component tree, layout hierarchy, interaction notes
  design-tokens.json         # colors, typography, spacing, radii, shadows
  components/                # per-component spec files (one .json per node)
  assets/                    # images, svgs, fonts referenced by spec.json
  preview/                   # standalone HTML preview (optional)
  manifest.json              # bundle metadata: source project, version, target route
```

Field names follow Anthropic's bundle layout (Apr 2026). If a key is missing,
treat `README.md` as source of truth and adapt.

## When to use

- User says: "import this Claude Design bundle", "build the design from
  `.design/handoff/...`", or invokes `/import-claude-design`.
- A new `.zip` lands in `.design/handoff/`.
- The `claude-design-browser` skill just finished and called you in.

## Workflow

### Step 1 — Ingest

If the user gave a `.zip` path:

```bash
node scripts/ingest-claude-design.mjs <path-to-zip> [--slug <slug>]
```

The script:
- unpacks into `.design/handoff/<slug>/`,
- validates `spec.json`, `design-tokens.json`, `README.md` are present,
- prints a one-screen summary.

If the user only gave a share URL, ask them to use "Export → .zip" in
Claude Design (or run `/claude-design`), then drop the file in.

### Step 2 — Read the bundle in this exact order

1. `manifest.json` — get `target_route`, `entrypoint`, `source_project`,
   `claude_design_version`. If `claude_design_version` is newer than this
   skill anticipates, stop and ask the user to update the skill before
   consuming. Bundle format changes between versions.
2. `README.md` — Anthropic-generated per-project notes. Honor any
   "do/do not" rules there before falling back to defaults.
3. `design-tokens.json` — diff against existing tokens (Step 3).
4. `spec.json` — component tree, layout, interactions.
5. `components/` — only open the ones referenced in the route you build.
6. `assets/` — only copy assets actually referenced by `spec.json`.

### Step 3 — Reconcile design tokens against the existing system

The frontend already has tokens. Do not blindly overwrite them.

1. Locate existing tokens: `{{tokens_file}}` (and any
   Tailwind / theme config at the project root).
2. For each token in `design-tokens.json`:
   - If a semantically equivalent token exists (same role, e.g.
     `--color-primary`), reuse it; map the bundle name to the existing
     name in your implementation.
   - If genuinely new, add it under the existing convention, not
     Anthropic's naming.
   - If it conflicts (same name, different value), surface the conflict
     to the user and stop. Do not silently change brand colors.
3. Never copy raw hex values into components. Always go through the
   token layer.

### Step 4 — Generate components against the existing library

1. Identify reusable components in `{{components_dir}}`. Match by role
   (Button, Modal, Card, FormField), not by bundle node name.
2. For each leaf in `spec.json` that maps to an existing component,
   instantiate the existing component. Do not duplicate.
3. New components go in `{{components_dir}}/` following the existing
   patterns (functional components, hooks, file/function size limits as
   documented in the project's own rules).
4. Page-level composition goes in `{{pages_dir}}/`. Honor
   `manifest.target_route`.
5. i18n: any user-visible string goes through `{{i18n_dir}}/`. Never
   hardcode strings into components.

### Step 5 — Assets

1. Copy referenced files from `.design/handoff/<slug>/assets/` to the
   project's existing public/static path.
2. SVGs that act as icons go through the existing icon component
   pattern, not raw `<img>`.
3. Skip unreferenced assets.

### Step 6 — Interactions and state

`spec.json` may include interaction notes (`onClick → openModal`,
`onSubmit → POST /api/...`). Treat as design intent, not implementation
contract. Wire to existing services in `{{services_dir}}/`. Never invent
new endpoints; if the spec references an endpoint that does not exist,
stop and surface the gap.

### Step 7 — Verify

1. `{{lint_cmd}}` — must pass.
2. `{{build_cmd}}` — must pass.
3. If the bundle ships a `preview/` HTML, open it side by side with
   `{{dev_cmd}}` and confirm parity. Spacing < 4 px and color drift
   inside a single token are acceptable.

### Step 8 — Bundle hygiene

- Tracked in git: `manifest.json`, `spec.json`, `design-tokens.json`,
  `README.md`, `components/**` (specs).
- Ignored in git: `*.zip`, `assets/`, `preview/`. The bridge installer
  added these patterns to `.gitignore`.

## Reverse direction (project → Claude Design)

There is no native push from Cursor into Claude Design. Two bridges:

- **Live UI capture (preferred):** run `{{dev_cmd}}`, then in
  claude.ai/design use "Web capture" against the local URL or a staging
  deploy.
- **Figma MCP (designer in the loop):** the Figma MCP server is the only
  writable bridge between an IDE and a design canvas. Use when the
  artifact must end up in Figma.

Do not build a custom uploader to Claude Design. The endpoints behind
"Send to Claude Code" are not public.

## Failure modes — stop, do not improvise

- Bundle missing `spec.json` or `manifest.json` → stop, ask user to
  re-export.
- `claude_design_version` newer than this skill anticipates → stop, ask
  user to update the skill.
- Token conflict against existing brand tokens → stop, surface conflict.
- Spec references a backend endpoint that does not exist → stop, surface
  gap (do not scaffold a stub endpoint here).
- `frontier: true` in `spec.json` (voice / video / shaders / 3D / in-bundle
  AI) → hand back to the user for manual review before touching code.
