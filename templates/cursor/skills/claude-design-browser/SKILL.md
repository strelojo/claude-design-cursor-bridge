---
name: claude-design-browser
description: Drive claude.ai/design via the cursor-ide-browser MCP to generate a UI design from a prompt, export the bundle, and hand off to the import-claude-design skill. Use when the user says "generate via browser", "open Claude Design", "make me a design", or invokes /claude-design.
---

# Claude Design via Browser MCP

This skill is for **any agent**, regardless of model. Do not assume prior
knowledge of Anthropic's products. Read the Background section below before
acting.

## Background — what you are interacting with

- **Claude Design** is a web app at `https://claude.ai/design` published by
  Anthropic. It generates UI mockups and interactive prototypes from a text
  prompt. It launched in April 2026 and requires a paid Claude account
  (Pro / Max / Team / Enterprise). Free accounts cannot use it.
- The app has three main surfaces:
  1. **Project list** at `/design` (shows existing projects, "+ New" affordance).
  2. **Prototype creator** modal: project name, "Wireframe" vs "High fidelity"
     choice, "Create" button.
  3. **Project canvas** at `/design/p/<uuid>`: left chat pane to iterate, right
     preview iframe rendering the live prototype, top-right toolbar with
     export menu.
- The export menu (top-right arrow icon "↗") offers:
  - "Download project as .zip" → ships **only HTML + JSX components**, no
    `spec.json`. Useful as raw code reference.
  - "Handoff to Claude Code…" → ships the **structured bundle** with
    `spec.json`, `design-tokens.json`, `README.md`, `components/`, `assets/`.
    **Prefer this** because the import skill expects that layout.
  - PDF / PPTX / Canva exports → not relevant here.
- The browser tab persists Anthropic's session cookie. After the user's
  first manual login, future runs do not require login again.
- **You drive the page through the `cursor-ide-browser` MCP**, not by writing
  Selenium / Playwright code. You take snapshots to read element refs, then
  click / fill / press_key against those refs.

## Hard preconditions — verify before doing anything

1. The `cursor-ide-browser` MCP must be available. Required tools:
   `browser_tabs`, `browser_navigate`, `browser_lock`, `browser_snapshot`,
   `browser_click`, `browser_fill`, `browser_press_key`, `browser_take_screenshot`,
   `browser_wait_for`. If any are missing, stop and tell the user to enable
   the cursor-ide-browser MCP in Cursor settings.
2. The user must have a paid Claude account. If you land on a
   "/login?returnTo=%2Fdesign" URL even after successful login, the account
   tier is too low. Stop, tell the user to upgrade.
3. `unzip` must exist on PATH. Verify: `which unzip` returns a path.
4. The project has been bootstrapped with the bridge: the file
   `.cursor/skills/import-claude-design/SKILL.md` exists. If not, tell the
   user to run `cdc init` (from the `claude-design-cursor-bridge` package).

## Inputs

- A free-form **prompt** (the design brief).
- Optional **slug** for the export folder.
- Optional **project name** (defaults to a slug derived from the prompt).
- Optional **fidelity**: "wireframe" or "highfidelity" (default: highfidelity).

If the prompt is shorter than ~30 words or lacks design tokens / layout /
screens, **stop and ask the user to expand it** using the template at the
bottom of this skill. Vague prompts produce vague designs and waste tokens.

## Workflow — exact sequence

### Step 1 — Open or focus the Claude Design tab

```
browser_tabs({ action: "list" })
```

- If a tab on `claude.ai/design*` exists, target it. Otherwise:
  ```
  browser_navigate({ url: "https://claude.ai/design" })
  ```
- Lock the tab so other operations do not steal focus:
  ```
  browser_lock({ action: "lock" })
  ```
- Take an initial snapshot:
  ```
  browser_snapshot({ take_screenshot_afterwards: true })
  ```

### Step 2 — Handle login if needed

If the snapshot URL is `https://claude.ai/login?returnTo=%2Fdesign`:

1. Tell the user **explicitly** in chat: "You need to log in manually in
   the browser tab. I cannot enter your password (Cloudflare/2FA blocks
   automation)."
2. Optionally accept/reject the cookie banner (look for "Reject" or
   "Accept" button refs in the snapshot, click whichever you prefer).
3. Wait for the user. Poll every ~10 seconds with `browser_snapshot` (max
   5 minutes). When the URL is back on `claude.ai/design` and you see
   buttons like "Wireframe", "High fidelity", "Create" — login succeeded.
4. If 5 minutes pass without progress, stop and report.

### Step 3 — Skip intro / dismiss any modal

The `/design` landing may show an intro slide ("Import your team's design
system") with a "Skip intro" button (ref typically named `Skip intro` or
`Dismiss`). Click it if present. Take a fresh snapshot.

### Step 4 — Create a new prototype

The new-project form has these elements (names exactly as they appear in
snapshots):

- `textbox name: "Project name"` — fill with the project name.
- `button name: "Wireframe"` and `button name: "High fidelity"` — click
  the chosen one. **High fidelity** is selected by default.
- `button name: "Create"` — disabled until the project name is filled.

Sequence:

```
browser_fill({ ref: "<project name textbox ref>", value: "<project name>" })
browser_click({ ref: "<High fidelity button ref>" })   // optional, often default
browser_click({ ref: "<Create button ref>" })
```

Wait ~3 seconds, then snapshot. The URL should change to
`https://claude.ai/design/p/<uuid>` and the canvas chat appears.

### Step 5 — Submit the prompt

The canvas chat has:

- `textbox name: "Describe what you want to create..."` — the main prompt input.
- `button name: "Send"` — sends the prompt.

```
browser_fill({ ref: "<prompt textbox ref>", value: "<the full prompt>" })
browser_click({ ref: "<Send button ref>" })
```

After clicking Send, the Send button is replaced by a `Stop` button. That
is your signal that generation started.

### Step 6 — Wait for generation

Hi-fi prototypes take 1–5 minutes. Poll with backoff:

```
browser_wait_for({ time: 45 })
browser_take_screenshot({})
```

Look for these signals in the screenshot or snapshot:

- "Copying starter" → "Writing" → "Placed <Component>" lines appear during
  generation. Generation is still running.
- The `Stop` button disappears and `Send` reappears (now disabled because
  the prompt textbox is empty) — generation is done.
- A Preview tab is auto-selected showing the rendered prototype.

If 7 minutes pass without a Preview tab, stop and report.
If you see an error banner (rate limit, moderation, model error), stop and
quote it verbatim. Do not retry silently.

### Step 7 — Open the export menu and download the bundle

Top-right toolbar has two unnamed buttons (refs typically `e4` and `e5`).
The second one (`e5` in our reference run) opens the export menu. Click it:

```
browser_click({ ref: "<top-right arrow button ref>" })
```

The menu reveals these buttons (names exactly as they appear):

- `Copy link`
- `Duplicate project`
- `Duplicate as template`
- `Download project as .zip`
- `Export as PDF`
- `Export as PPTX…`
- `Send to Canva…`
- `Export as standalone HTML`
- `Handoff to Claude Code…`

**Decision rule:**

- If the user wants a **structured bundle** for the import skill →
  `Handoff to Claude Code…` (preferred default).
- If the user only wants the **raw React code** for reference →
  `Download project as .zip`.

Click the chosen button. Wait ~5 seconds for the download to start.

### Step 8 — Locate the downloaded file

Order of fallback paths to check (cross-platform):

```bash
WIN_USER="$(/mnt/c/Windows/System32/cmd.exe /C 'echo %USERNAME%' 2>/dev/null | tr -d '\r' 2>/dev/null)"
candidates=(
  "/mnt/c/Users/${WIN_USER}/Downloads"   # WSL → Windows host
  "${HOME}/Downloads"                     # macOS / Linux
  "${HOME}/Desktop"                       # mac default if user changed it
  "/tmp"
)
for d in "${candidates[@]}"; do
  [ -d "$d" ] || continue
  hit="$(ls -1t "$d"/*.zip "$d"/*.tmp 2>/dev/null | head -n 1)"
  if [ -n "$hit" ]; then
    # accept files modified in the last 5 minutes only
    age=$(($(date +%s) - $(stat -c %Y "$hit" 2>/dev/null || stat -f %m "$hit")))
    [ "$age" -lt 300 ] && { echo "$hit"; break; }
  fi
done
```

**Important quirk observed:** the `cursor-ide-browser` engine sometimes
saves downloads with a UUID `.tmp` extension instead of `.zip`. Verify
with `file <path>` — if it reports `Zip archive data`, treat it as a zip
and rename to `.zip` before ingest.

If no file is found within 30 s, ask the user to confirm the download
location. Do not invent a path.

### Step 9 — Release the browser, ingest the bundle

```
browser_lock({ action: "unlock" })
```

Then prefer the MCP tool (registered as `claude-design-bridge` in
`.cursor/mcp.json`):

```
ingest_bundle({ zip_path: "<absolute path>", slug: "<optional>" })
```

Returns structured `{ ok, slug, destination, ... }`. If the call returns
`isError: true`:

- "missing required files" → the user chose "Download as .zip" instead of
  "Handoff to Claude Code". Two options:
  a. Re-run from Step 7 with the correct export choice.
  b. Manually copy the bundle into `.design/handoff/<slug>/source.zip` and
     extract — the import skill has a fallback path for raw-jsx bundles.
- "claude_design_version newer than expected" → stop, surface to user.

Fallback if the MCP server is not in this session:

```bash
node scripts/ingest-claude-design.mjs "<absolute-zip-path>" [--slug <slug>]
```

### Step 10 — Hand off

Read `.cursor/skills/import-claude-design/SKILL.md` and follow it from
Step 2 onwards (Step 1 of that skill is the ingest you just did).

## Failure modes — stop, do not improvise

- **Cloudflare interstitial / captcha** during login: stop, ask user to
  complete manually in the locked tab.
- **Rate limit** banner in claude.ai: stop, quote it.
- **Bot-detection block**: stop. Do not retry from a different session.
- **Two consecutive empty snapshots** after an action (no DOM diff): stop,
  capture a screenshot, surface to user.
- **No file found in any download candidate dir** within 30 s: stop, ask
  user where their browser saves files.
- **`cursor-ide-browser` not available**: stop, this skill cannot proceed.

## Notes on TOS and rate

- This skill mirrors a human session in a logged-in browser. It does not
  scrape, bypass auth, or call private endpoints.
- Do not run in CI. Do not run against accounts you do not control.
- Do not parallelize multiple browser sessions.
- Iteration via the browser (slider tweaks, inline comments) is possible
  but slow. For >2 refinement cycles, switch to the claude.ai/design tab
  manually.

## Tool-call sequence (cheat sheet)

```
1.  browser_tabs(list)
2.  browser_navigate("https://claude.ai/design")
3.  browser_lock(lock)
4.  browser_snapshot
5.  [if /login → wait for user]
6.  click "Skip intro" if present
7.  browser_fill(project-name)
8.  click "High fidelity" (optional)
9.  click "Create"
10. browser_wait_for(3) + snapshot
11. browser_fill(prompt)
12. click "Send"
13. loop: browser_wait_for(45) + screenshot until generation done (~1-5 min)
14. click top-right arrow → export menu
15. click "Handoff to Claude Code…" (preferred) or "Download project as .zip"
16. Shell: find newest .zip|.tmp in Downloads dirs (last 5 min)
17. browser_lock(unlock)
18. ingest_bundle({ zip_path, slug })  OR  node scripts/ingest-claude-design.mjs
19. read .cursor/skills/import-claude-design/SKILL.md and continue
```

## Prompt template — paste this back to the user if their input is too vague

```
Redesign <component name> for a <product context>.

Design tokens (must match):
- background <hex>, foreground <hex>
- primary <hex>, accent <hex>
- border <rgba>, radius <value>
- font: <family>

Layout:
- <top-down description of sections>
- <list of all interactive elements with their states>

Generate <N> screens:
- Screen 1: <concrete state>
- Screen 2: <concrete state>
- Screen N: <concrete state>

Style: <reference, e.g. "like Linear / Vercel / Stripe">
Bilingual labels OK (English primary, German subtitle muted).

Deliver as interactive prototype with all screens reachable.
```
