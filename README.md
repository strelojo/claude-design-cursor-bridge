# claude-design-cursor-bridge

Bridge **Claude Design** (`claude.ai/design`) into **any Cursor project**.

Cursor is not a first-class target for Claude Design — Anthropic only ships a
"Send to Claude Code" button. This bridge fills the gap by:

1. Driving `claude.ai/design` from inside Cursor via the **`cursor-ide-browser`
   MCP** (prompt → wait → export `.zip`).
2. Ingesting the resulting `.zip` into a project-local
   `.design/handoff/<slug>/` folder using the same machine-readable layout
   Anthropic ships to Claude Code.
3. Installing **two reusable Cursor skills**, two slash commands, an
   auto-attach rule, and the ingest script — adapted to your project's
   framework (Next.js / Vite-React / Vue / Svelte / generic).
4. Registering an **MCP server** (`claude-design-bridge`) that exposes the
   deterministic operations as typed tool calls — works in Cursor, Claude
   Code, Windsurf, Cline, Codex.

## Architecture in one diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Cursor agent (or any MCP-aware client)                              │
│                                                                      │
│   slash command         skills                MCP server             │
│   ─────────────         ──────                ──────────             │
│   /claude-design   →    claude-design-browser SKILL.md               │
│                          │                                           │
│                          ▼ uses cursor-ide-browser MCP               │
│                         drives claude.ai/design (your logged-in tab) │
│                          │                                           │
│                          ▼ exports .zip                              │
│                          │                                           │
│                          ▼ calls  ingest_bundle()  ─────────────┐    │
│                                                                 │    │
│   /import-claude-design → import-claude-design SKILL.md         │    │
│                          │                                      │    │
│                          ▼ calls inspect_bundle, read_spec,     │    │
│                                  read_tokens, read_readme       │    │
│                          │                                      │    │
│                          ▼                                      │    │
│   implements against the project's frontend                     │    │
│                                                                 ▼    │
│                                                ┌──────────────────┐  │
│                                                │ claude-design-   │  │
│                                                │ bridge MCP       │  │
│                                                │ (cdc-mcp.mjs)    │  │
│                                                │                  │  │
│                                                │ ingest_bundle    │  │
│                                                │ list_bundles     │  │
│                                                │ inspect_bundle   │  │
│                                                │ read_spec        │  │
│                                                │ read_tokens      │  │
│                                                │ read_readme      │  │
│                                                │ doctor           │  │
│                                                └──────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Browser-driven generation **stays in the skill** because it relies on your
already-logged-in browser tab. A standalone Playwright would need its own
Chromium + cookie store + 2FA handling — strictly worse.

The deterministic ops (`ingest`, `list`, `inspect`, `read_*`, `doctor`)
**move into the MCP server** because they are typed, side-effect-bounded,
and useful from any MCP client.

Result: in any project, `/claude-design <your prompt>` produces a working
implementation against your existing components and design tokens, without
manual tab switching.

---

## Install

You do **not** install this globally. Run it via `npx` from inside the project
you want to wire up.

```bash
cd /path/to/my-project
npx claude-design-cursor-bridge init
```

(or, if you cloned this repo locally:)

```bash
node /path/to/claude-design-cursor-bridge/bin/cdc.mjs init /path/to/my-project
```

What `init` does:

- detects the project framework and frontend layout,
- writes `.cursor/skills/claude-design-browser/SKILL.md`,
- writes `.cursor/skills/import-claude-design/SKILL.md`,
- writes `.cursor/commands/claude-design.md` and
  `.cursor/commands/import-claude-design.md`,
- writes `.cursor/rules/design-handoff.mdc` (auto-attaches to your frontend
  paths),
- writes `scripts/ingest-claude-design.mjs`,
- writes `.design/handoff/README.md` and `.gitkeep`,
- patches `.gitignore` so `.zip`s and asset binaries stay untracked but
  spec JSON is committed,
- registers the `claude-design-bridge` MCP server in
  `.cursor/mcp.json` (skip with `--no-mcp`).

Re-run with `--force` to overwrite. Re-run with custom paths if detection got
it wrong:

```bash
npx claude-design-cursor-bridge init \
  --framework next \
  --components-dir components \
  --tokens-file app/globals.css \
  --lint "pnpm lint" \
  --build "pnpm build"
```

Verify:

```bash
npx claude-design-cursor-bridge doctor
```

---

## Daily use

Inside Cursor's agent chat:

### Generate from scratch via browser

```
/claude-design

Build a settings page for a SaaS app: account section with avatar + name + 
email, billing section with current plan + invoices table, danger zone with 
delete-account button. Use the project's existing tokens.
```

The agent will:

1. Open / focus a `claude.ai/design` tab via the browser MCP.
2. Wait for you to log in manually if needed.
3. Type the prompt, wait for generation.
4. Click **Export → .zip**.
5. Locate the download (WSL: probes `/mnt/c/Users/<you>/Downloads` first,
   then `~/Downloads`).
6. Run the ingest script, unpack into `.design/handoff/<slug>/`.
7. Hand off to the import skill, which generates code against your repo.

### Import a `.zip` you already have

```
/import-claude-design  ~/Downloads/claude-design-foo.zip
```

Or: drop the `.zip` into the project, then in chat:

```
/import-claude-design
```

### Auto-watch downloads

```bash
npx claude-design-cursor-bridge watch .
```

Any new `claude-design-*.zip` in `~/Downloads` gets unpacked into the current
project's `.design/handoff/`. Useful if you generate manually in the browser
and want zero shell friction afterwards.

---

## What the bridge gives you per project

```
my-project/
├── .cursor/
│   ├── skills/
│   │   ├── claude-design-browser/SKILL.md     ← drives claude.ai/design
│   │   └── import-claude-design/SKILL.md      ← consumes the bundle
│   ├── commands/
│   │   ├── claude-design.md                   ← /claude-design
│   │   └── import-claude-design.md            ← /import-claude-design
│   └── rules/
│       └── design-handoff.mdc                 ← auto-attach on frontend files
├── .design/
│   └── handoff/
│       ├── README.md
│       └── .gitkeep
├── scripts/
│   └── ingest-claude-design.mjs
├── .gitignore                                 ← .design/handoff/**/*.zip etc.
└── .cursor/mcp.json                           ← registers claude-design-bridge MCP server
```

All paths inside the skills are resolved against your detected framework.

## MCP server tools

Once `init` has run, any MCP-aware client in the project sees these tools
under server `claude-design-bridge`:

| Tool             | Args                                          | Returns                           |
|------------------|-----------------------------------------------|-----------------------------------|
| `ingest_bundle`  | `zip_path`, `slug?`, `force?`, `project_root?` | `{ok, slug, destination, ...}`    |
| `list_bundles`   | `project_root?`                               | `{bundles: [...]}`                |
| `inspect_bundle` | `slug`, `project_root?`                       | manifest + counts                 |
| `read_spec`      | `slug`, `project_root?`                       | parsed `spec.json`                |
| `read_tokens`    | `slug`, `project_root?`                       | parsed `design-tokens.json`       |
| `read_readme`    | `slug`, `project_root?`                       | raw `README.md`                   |
| `doctor`         | `project_root?`                               | install + tool availability       |

In another IDE that does not auto-load `.cursor/mcp.json`, register it
manually. Example for Claude Code (`~/.claude.json` or project
`.mcp.json`):

```json
{
  "mcpServers": {
    "claude-design-bridge": {
      "command": "node",
      "args": ["/path/to/claude-design-cursor-bridge/bin/cdc-mcp.mjs"]
    }
  }
}
```

Cursor reads `.cursor/mcp.json` automatically.

---

## Framework detection

| Detected via                                  | Slug          | Default tokens file        | Default components dir      |
|-----------------------------------------------|---------------|----------------------------|-----------------------------|
| `dependencies.next`                           | `next`        | `app/globals.css`          | `components`                |
| `dependencies.@sveltejs/kit` or `svelte`      | `svelte`      | `src/app.css`              | `src/lib/components`        |
| `dependencies.nuxt` or `vue`                  | `vue`         | `src/assets/main.css`      | `src/components`            |
| `dependencies.vite` + `react`                 | `vite-react`  | `src/index.css`            | `src/components`            |
| anything else                                 | `generic`     | `src/styles/tokens.css`    | `src/components`            |

The installer also probes common monorepo layouts (`packages/frontend/...`,
`apps/web/...`) and prefers an existing dir over the default.

Override anything with `--components-dir`, `--tokens-file`, `--lint`,
`--build`.

---

## Hard limits — read once, internalise

- **Login**: required and manual the first time. The MCP browser has no
  cookies. After login, the Chromium profile keeps the session.
- **Captcha / Cloudflare**: may block. Skill stops and asks for human help.
- **Downloads**: file lands in the browser's default download dir. The
  skill probes WSL Windows-Downloads then Linux-Downloads then `/tmp`.
  If your browser still uses a save dialog, ingest manually.
- **TOS**: do not run in CI, do not script multiple accounts, do not
  parallelise sessions. This bridge is for your own logged-in session.
- **Iteration**: visual refinement (sliders, inline comments) via the
  browser MCP is slow. For >2 cycles, switch to the tab manually.
- **Bundle format drift**: Anthropic versions the bundle in
  `manifest.claude_design_version`. The skill stops on unknown versions
  rather than guessing.

---

## What this bridge does **not** do

- It does not call any private Anthropic endpoint.
- It does not ship a Claude Design API client (none is public).
- It does not push designs from your project back into Claude Design.
  Use Claude Design's "Web capture" against your running dev server, or
  the Figma MCP if a designer is in the loop.
- It does not generate UI on its own — it orchestrates Claude Design and
  hands the bundle to your Cursor agent.

---

## Uninstall

```bash
rm -rf .cursor/skills/claude-design-browser \
       .cursor/skills/import-claude-design \
       .cursor/commands/claude-design.md \
       .cursor/commands/import-claude-design.md \
       .cursor/rules/design-handoff.mdc \
       scripts/ingest-claude-design.mjs \
       .design/handoff
```

(Optional) revert the `.gitignore` block. The `.design/handoff/<slug>/`
directories are safe to delete; the bundles are reproducible from claude.ai.

---

## License

MIT.
