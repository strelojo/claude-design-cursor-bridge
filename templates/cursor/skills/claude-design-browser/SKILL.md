---
name: claude-design-browser
description: Drive claude.ai/design via the cursor-ide-browser MCP to generate a design from a prompt, export the .zip, and hand off to the import-claude-design skill. Use when the user says "generate via browser", "open Claude Design", "make me a design", or invokes /claude-design.
---

# Claude Design via Browser MCP

Generate a Claude Design bundle without leaving Cursor. This skill drives the
browser for you. After the export lands locally, control passes to
`.cursor/skills/import-claude-design/SKILL.md`, which builds against the repo.

## Hard preconditions — verify before doing anything

1. The `cursor-ide-browser` MCP must be available in this session. If
   `browser_navigate`, `browser_snapshot`, `browser_lock`, etc. are not in your
   tool list, stop and tell the user to enable the cursor-ide-browser MCP.
2. The user must already have a paid Claude account (Pro / Max / Team /
   Enterprise). Free tier has no Claude Design.
3. `unzip` must exist on PATH (the ingest step uses it).
4. The target project has been bootstrapped with the bridge:
   `.cursor/skills/import-claude-design/SKILL.md` and
   `scripts/ingest-claude-design.mjs` exist. If not, stop and tell the user to
   run `npx claude-design-cursor-bridge init` from the project root.

## Inputs

- A free-form **prompt** (the design brief).
- Optional **slug** for the export folder (default: derived from the zip name).
- Optional **target route** that the design will eventually map to in the repo
  (e.g. `/dashboard`). Forwarded to the import skill via the bundle's
  `manifest.target_route` if Claude Design fills that in; otherwise informational.

## Workflow

### Step 1 — Open or focus the Claude Design tab

1. `browser_tabs` action `list`. If a tab on `claude.ai/design` already exists, target it.
2. Otherwise `browser_navigate` to `https://claude.ai/design`.
3. `browser_lock` action `lock` on that tab. Keep it locked until Step 7.
4. `browser_snapshot`. If the page is the login screen:
   - Tell the user **explicitly** that they must log in manually in the
     locked browser tab. Do not attempt password entry — automated login
     trips Cloudflare and 2FA.
   - Wait via `AwaitShell` polling-style (small `browser_snapshot`s every
     ~3s) until the URL is back on `claude.ai/design` and you see the
     project list / canvas chat.
   - If the user does not log in within ~3 minutes, stop and report.

### Step 2 — Start a new project

1. From the snapshot, find the "New project" / "+" affordance. Click it.
2. New `browser_snapshot`. Confirm the canvas + chat split is visible
   (a left chat pane and a right preview area).

### Step 3 — Submit the prompt

1. Locate the chat input (a `textarea` or `contenteditable`). Use the ref
   from the latest snapshot.
2. `browser_fill` the user's prompt. If `browser_fill` fails on a
   `contenteditable`, fall back to `browser_type`.
3. Trigger send: either click the send button by ref, or
   `browser_press_key` with `Enter` while the input is focused.
4. Take one screenshot for the user log (`browser_take_screenshot`,
   `take_screenshot_afterwards: true` is fine).

### Step 4 — Wait for generation

Claude Design typically renders the first version in 30–90 s.

1. Poll loop (max ~3 min):
   - Wait 5 s (`AwaitShell` block_until_ms 5000).
   - `browser_snapshot`.
   - Look for the **Export** button enabled in the top-right toolbar AND
     the absence of a generating-spinner / streaming indicator in the
     chat. Both must be true.
2. If the page ends up in an error state (rate limit, model error,
   moderation block) → stop and report verbatim what you saw. Do not
   retry silently.

### Step 5 — Export to .zip

1. Click **Export** (top-right). New snapshot.
2. From the export menu, click **".zip"** (NOT "Standalone HTML" — HTML
   lacks `spec.json` and the import skill will refuse it).
3. Snapshot. Some Anthropic releases show a "Download" confirm button —
   click it if present.
4. Note the **expected filename** if visible; otherwise it is typically
   `claude-design-<project-name>-<timestamp>.zip`.

### Step 6 — Locate the downloaded file

The `cursor-ide-browser` MCP saves downloads into the Chromium profile's
download dir. That is normally the OS Downloads folder, but not
guaranteed.

Run a Shell command — order of fallbacks:

```bash
# WSL-aware: prefer the Windows Downloads if mounted, else $HOME/Downloads
WIN_USER="$(/mnt/c/Windows/System32/cmd.exe /C 'echo %USERNAME%' 2>/dev/null | tr -d '\r')"
candidates=(
  "/mnt/c/Users/${WIN_USER}/Downloads"
  "${HOME}/Downloads"
  "${HOME}/.cache/ms-playwright"
  "/tmp"
)
for d in "${candidates[@]}"; do
  [ -d "$d" ] || continue
  hit="$(find "$d" -maxdepth 3 -type f -name '*.zip' -mmin -5 2>/dev/null \
        | xargs -I{} ls -1t {} 2>/dev/null | head -n 1)"
  [ -n "$hit" ] && { echo "$hit"; break; }
done
```

Capture the printed path. If empty, ask the user for the path manually
(some browsers still prompt a save dialog the first time).

### Step 7 — Release the browser, ingest the bundle

1. `browser_lock` action `unlock`. Done with the browser for this turn.
2. Run the ingest script in the **target project root**:

   ```bash
   node scripts/ingest-claude-design.mjs "<absolute-zip-path>" [--slug <slug>]
   ```

   The script unpacks into `.design/handoff/<slug>/` and prints a
   summary. If it exits 3 (missing required files), stop and report — do
   not blindly proceed. Anthropic may have changed the bundle layout.

### Step 8 — Hand off to the import skill

Read `.cursor/skills/import-claude-design/SKILL.md` and follow it from
Step 2 onwards (Step 1 of that skill is the ingest you just did).

## Failure modes — stop, do not improvise

- **Cloudflare interstitial / captcha** during login: stop, ask the user
  to complete manually in the locked tab.
- **Rate limit** banner in claude.ai: stop, surface the message.
- **Bot-detection block** after Step 3: stop. Do not retry from a
  different IP. Tell the user to generate manually this time.
- **Two consecutive empty snapshots** (no DOM diff after action): stop,
  capture a screenshot, surface to user.
- **No `.zip` found in any candidate dir** within 30 s of clicking
  download: stop, ask user where their browser saves files. Do not
  fabricate a path.
- **`cursor-ide-browser` not available**: stop, this skill cannot
  proceed without it.

## Notes on TOS and rate

- This skill mirrors a human session in a logged-in browser. It does
  **not** scrape, bypass auth, or call private endpoints.
- Do not run this in CI. Do not run it against accounts you do not
  control. Do not parallelise multiple browser sessions.
- Iteration via the browser (slider tweaks, inline comments) is
  possible but slow. For >2 refinement cycles, switch to the
  claude.ai/design tab manually.

## Quick recap of the tool calls (in order)

```
browser_tabs(list) → browser_navigate?(claude.ai/design) → browser_lock(lock)
→ browser_snapshot → [user logs in if needed] → browser_snapshot
→ click "+ New project" → browser_snapshot
→ browser_fill(prompt) → browser_press_key(Enter)
→ loop: AwaitShell(5s) + browser_snapshot until Export enabled
→ click Export → click ".zip" → click confirm
→ Shell(find newest .zip) → browser_lock(unlock)
→ Shell(node scripts/ingest-claude-design.mjs <path>)
→ read .cursor/skills/import-claude-design/SKILL.md and continue
```
