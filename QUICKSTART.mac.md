# Claude Design in Cursor — Quickstart (macOS)

Anleitung für macOS-Nutzer (Apple Silicon und Intel). Stand: April 2026.

Diese Bridge verbindet **Claude Design** (`claude.ai/design`) mit **jedem Cursor-Projekt**: Prompt im Chat → Browser generiert Mockup → ZIP wird automatisch ins Projekt importiert → Cursor implementiert gegen den bestehenden Frontend-Code.

---

## 0. Voraussetzungen

- **macOS 13 Ventura** oder neuer
- **Cursor IDE** (Desktop) — [https://cursor.com/download](https://cursor.com/download)
- **Claude Pro oder Max** Account (Free reicht für Claude Design nicht) — [https://claude.ai/upgrade](https://claude.ai/upgrade)
- **Homebrew** installiert — falls nicht: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- **Node.js ≥ 18.17** und **`unzip`**:

```bash
brew install node
node -v       # >= 18.17 erwartet
which unzip   # macOS bringt unzip mit
```

---

## 1. Bridge einmalig installieren

```bash
git clone https://github.com/strelojo/claude-design-cursor-bridge ~/claude-design-cursor-bridge
cd ~/claude-design-cursor-bridge
npm install
npm link
```

`npm link` registriert zwei globale CLI-Befehle:

- `cdc` — der CLI für `init`, `ingest`, `watch`, `doctor`
- `cdc-mcp` — der MCP-Server (wird vom Cursor-Agent automatisch gestartet)

Verifizieren:

```bash
which cdc            # sollte /opt/homebrew/bin/cdc oder /usr/local/bin/cdc zeigen
cdc --help           # zeigt die CLI-Hilfe
```

**macOS-Spezialfall:** Wenn `which cdc` nichts findet (Apple Silicon mit `nvm`):

```bash
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
cdc --help
```

**Gatekeeper-Hinweis:** Bei den ersten Aufrufen kann macOS die Skripte als "von einem nicht verifizierten Entwickler" blockieren. Einmalig erlauben:

```bash
xattr -d com.apple.quarantine ~/claude-design-cursor-bridge/bin/*.mjs 2>/dev/null
```

---

## 2. Bridge in dein Projekt einhängen

```bash
cd /pfad/zu/deinem/projekt
cdc init
```

`cdc init` erkennt automatisch dein Framework (Next.js, Vite-React, Vue, Svelte, generic) und installiert:

| Pfad | Zweck |
|---|---|
| `.cursor/skills/claude-design-browser/SKILL.md` | Skill für browser-getriebene Generierung |
| `.cursor/skills/import-claude-design/SKILL.md` | Skill für Bundle-Import + Implementierung |
| `.cursor/commands/claude-design.md` | Slash-Command `/claude-design` |
| `.cursor/commands/import-claude-design.md` | Slash-Command `/import-claude-design` |
| `.cursor/rules/design-handoff.mdc` | Auto-Attach-Regel für Frontend-Pfade |
| `.cursor/mcp.json` | Registriert MCP-Server `claude-design-bridge` |
| `scripts/ingest-claude-design.mjs` | Fallback-Script |
| `.design/handoff/` | Staging-Ordner für Bundles |
| `.gitignore`-Patches | Spec tracked, ZIPs/Assets ignoriert |

Wenn die automatische Erkennung danebenliegt:

```bash
cdc init --framework next --force \
  --lint  'pnpm lint' \
  --build 'pnpm build'
```

Verifizieren:

```bash
cdc doctor
```

Erwartete Ausgabe: alle Pfade ✓, `unzip` available, Skills + Commands gefunden.

---

## 3. Cursor neu laden

`Cmd + Shift + P` → **Developer: Reload Window**.

Damit lädt Cursor `.cursor/mcp.json` und startet den `claude-design-bridge` MCP-Server. Im Chat sind jetzt verfügbar:

- Slash-Commands: `/claude-design`, `/import-claude-design`
- MCP-Tools (für den Agent): `ingest_bundle`, `list_bundles`, `inspect_bundle`, `read_spec`, `read_tokens`, `read_readme`, `doctor`

---

## 4. Workflow A — Design im Browser generieren

Im Cursor-Chat:

```
/claude-design  redesign meines Login-Screens, dunkles Theme, Logo oben mittig, E-Mail + Passwort + "Anmelden"-Button im Brand-Stil
```

Was passiert:

1. Cursor-Agent öffnet via `cursor-ide-browser` MCP `https://claude.ai/design` in einem Browser-Tab.
2. **Erster Lauf**: Login-Screen erscheint. Du loggst dich **einmal manuell ein** (Google / E-Mail / SSO). Session wird im Browser-Profil persistiert — beim nächsten Mal kein Login mehr.
3. Agent setzt Project-Name, wählt **High fidelity**, klickt **Create**.
4. Agent tippt deinen Prompt in die Textbox und drückt Send.
5. Generierung läuft 1–5 Minuten ("Copying starter" → "Writing" → "Placed <Component>").
6. Wenn fertig, klickt der Agent oben rechts auf das Pfeil-Icon → wählt im Menü **"Handoff to Claude Code…"** (liefert vollständiges Spec-Bundle) ODER **"Download project as .zip"** (nur Komponenten-Code).
7. Bei macOS landen die Downloads in `~/Downloads/`.
8. Agent ruft `ingest_bundle({ zip_path, slug })` auf → entpackt nach `.design/handoff/<slug>/`.

**Wichtig zum Bundle-Format (Stand April 2026):**
- **"Download as .zip"** → nur `*.html` + `*.jsx` (Komponenten + Canvas)
- **"Handoff to Claude Code…"** → vollständiges Bundle mit `spec.json`, `design-tokens.json`, `README.md`, `components/`, `assets/`

Für saubere Reconciliation gegen vorhandene Tokens immer **Handoff to Claude Code** wählen.

---

## 5. Workflow B — Bestehendes Bundle importieren

Wenn du die ZIP bereits hast:

```
/import-claude-design /pfad/zur/design-export.zip
```

Oder per CLI direkt:

```bash
cdc ingest ~/Downloads/claude-design-login-screen.zip --slug login-screen
```

---

## 6. Implementierung im Frontend

Sobald das Bundle in `.design/handoff/<slug>/` liegt, schreibe im Chat:

```
implementiere .design/handoff/login-screen gegen src/components
```

Die `design-handoff.mdc`-Regel attached automatisch den `import-claude-design`-Skill, der die folgenden Schritte abarbeitet:

1. **Bundle inspizieren** (`inspect_bundle`, `read_readme`, `read_tokens`, `read_spec` via MCP)
2. **Token-Reconciliation** gegen die existierende CSS / Tailwind-Config — Brand-Farben gewinnen
3. **Komponenten generieren**, dabei **bestehende Library wiederverwenden**
4. **Assets** selektiv kopieren (nur was tatsächlich gebraucht wird)
5. **Interaktionen** an bestehende Services binden (API-Calls, Stores, i18n)
6. **Lint + Build** laufen lassen

---

## 7. Watcher (optional)

```bash
cdc watch ~/Downloads
```

Jede neue ZIP, deren Name `claude-design` oder `design-export` enthält, wird automatisch ins aktuelle Projekt ingestiert.

**Tipp für Apple Silicon:** Wenn `fs.watch` flackert (FSEvents-Eigenheit), nutze stattdessen Polling:

```bash
cdc watch --poll 2000 ~/Downloads
```

---

## 8. MCP-Tools (für den Agent referenziert)

| Tool | Signatur | Zweck |
|---|---|---|
| `ingest_bundle` | `(zip_path, slug?, force?, project_root?)` | ZIP entpacken |
| `list_bundles` | `(project_root?)` | alle vorhandenen Slugs auflisten |
| `inspect_bundle` | `(slug, project_root?)` | Layout + Counts |
| `read_spec` | `(slug, project_root?)` | `spec.json` lesen |
| `read_tokens` | `(slug, project_root?)` | `design-tokens.json` lesen |
| `read_readme` | `(slug, project_root?)` | `README.md` lesen |
| `doctor` | `(project_root?)` | Setup-Check |

---

## 9. Troubleshooting (macOS-spezifisch)

| Symptom | Ursache | Fix |
|---|---|---|
| `cdc: command not found` | npm prefix nicht im PATH | `echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc` |
| `xcrun: error: invalid active developer path` | Xcode-CLI fehlt | `xcode-select --install` |
| Slash-Commands erscheinen nicht | `.cursor/`-Files nicht da | `cdc init` im Projekt-Root erneut |
| MCP-Tools fehlen im Chat | Cursor nicht reloaded | `Cmd + Shift + P` → Reload Window |
| `unzip not found` | unwahrscheinlich, mac liefert es mit | `brew install unzip` |
| Browser landet auf Login-Loop | Pro/Max-Account fehlt | Subscription kaufen |
| Generierung bricht ab | Stop gedrückt oder Quota erreicht | erneut senden, ggf. einfacheren Prompt |
| `EACCES` bei `npm link` | npm prefix gehört root | `sudo chown -R $(whoami) $(npm config get prefix)` |
| Browser-Downloads landen woanders | macOS Safari/Chrome unterschiedlich | manueller Pfad: `/import-claude-design <absoluter-pfad>` |
| Apple-Silicon: Permission denied | Quarantine-Flag auf Skripten | `xattr -dr com.apple.quarantine ~/claude-design-cursor-bridge` |

---

## 10. Ein guter Prompt-Aufbau (Best Practice)

Schwammige Prompts → schwammige Designs. Diese Struktur funktioniert reproduzierbar:

```
Redesign <Komponentenname> for a <Produkt-Kontext>.

Design tokens (must match):
- background <hex>, foreground <hex>
- primary <hex>, accent <hex>
- border <rgba>, radius <value>
- font: <family>

Layout:
- <Top-down Beschreibung der Sektionen>
- <Liste aller interaktiven Elemente mit Zuständen>

Generate N screens:
- Screen 1: <konkreter Zustand>
- Screen 2: <konkreter Zustand>
- Screen N: <konkreter Zustand>

Style: <Referenz, z. B. „like Linear / Vercel / Stripe">
Bilingual labels OK (English primary, German subtitle muted).

Deliver as interactive prototype with all screens reachable.
```

Je konkreter Tokens + States + Referenzen, desto näher das Ergebnis am Brand.

---

## 11. Was die Bridge **nicht** kann

- Push **Cursor → Claude Design** (kein Reverse-Sync; nutze stattdessen Claude Designs „Web capture" gegen den laufenden Dev-Server: `localhost:5173` etc.)
- Headless-Browser ohne Cursor (Browser-Generierung läuft ausschließlich über `cursor-ide-browser` MCP)
- Bypass für Anthropic-Login (manueller First-Login bleibt notwendig)
- Figma-Integration (separater Pfad: Figma MCP)

---

## Repo-Struktur (zur Orientierung)

```
claude-design-cursor-bridge/
├── bin/
│   ├── cdc.mjs           # CLI
│   └── cdc-mcp.mjs       # MCP-Server
├── templates/
│   ├── cursor/
│   │   ├── skills/{claude-design-browser,import-claude-design}/SKILL.md
│   │   ├── commands/{claude-design,import-claude-design}.md
│   │   └── rules/design-handoff.mdc
│   ├── design/handoff/{README.md,.gitkeep}
│   └── scripts/ingest-claude-design.mjs
├── package.json
├── README.md
├── QUICKSTART.de.md
└── QUICKSTART.mac.md
```
