# Claude Design in Cursor — Quickstart (DE)

Anleitung für Kolleginnen und Kollegen. Stand: April 2026.

Diese Bridge verbindet **Claude Design** (`claude.ai/design`) mit **jedem Cursor-Projekt**: Prompt im Chat → Browser generiert Mockup → ZIP wird automatisch ins Projekt importiert → Cursor implementiert gegen den bestehenden Frontend-Code.

---

## 0. Voraussetzungen

- **Cursor IDE** (Desktop oder Web) mit aktivem Account
- **Claude Pro oder Max** (Free reicht für Claude Design nicht)
- **Node.js ≥ 18.17**
- **`unzip`** auf dem System (`sudo apt-get install -y unzip` auf WSL/Linux, `brew install unzip` auf macOS)
- Das Repository **`claude-design-cursor-bridge`** geklont irgendwo auf der Platte

---

## 1. Bridge einmalig installieren

```bash
git clone <repo-url> ~/claude-design-cursor-bridge
cd ~/claude-design-cursor-bridge
npm install
npm link
```

`npm link` registriert zwei globale CLI-Befehle:

- `cdc` — der CLI für `init`, `ingest`, `watch`, `doctor`
- `cdc-mcp` — der MCP-Server (wird vom Cursor-Agent automatisch gestartet)

**WSL-Spezialfall:** Wenn `which cdc` nichts findet, prüfe die npm-prefix:

```bash
npm config get prefix
ls $(npm config get prefix)/bin/cdc 2>/dev/null || ls $(npm config get prefix)/bin/bin/cdc
```

Symlink in `~/.local/bin` legen und in `~/.bashrc` ergänzen:

```bash
mkdir -p ~/.local/bin
ln -sf $(realpath $(npm config get prefix)/bin/cdc 2>/dev/null || realpath $(npm config get prefix)/bin/bin/cdc) ~/.local/bin/cdc
ln -sf $(realpath $(npm config get prefix)/bin/cdc-mcp 2>/dev/null || realpath $(npm config get prefix)/bin/bin/cdc-mcp) ~/.local/bin/cdc-mcp
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
cdc --help    # muss die Hilfe zeigen
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

Wenn die automatische Erkennung danebenliegt (z. B. Lint/Build-Befehle), explizit setzen:

```bash
cdc init --framework vite-react --force \
  --lint  'npm --prefix packages/frontend run lint' \
  --build 'npm --prefix packages/frontend run build'
```

Verifizieren:

```bash
cdc doctor
```

Erwartete Ausgabe: alle Pfade ✓, `unzip` available, Skills + Commands gefunden.

---

## 3. Cursor neu laden

`Ctrl/Cmd + Shift + P` → **Developer: Reload Window**.

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
5. Generierung läuft 1–5 Minuten (siehst du im Browser-Panel: "Copying starter" → "Writing" → "Placed <Component>").
6. Wenn fertig, klickt der Agent oben rechts auf das Pfeil-Icon → **Download project as .zip**.
7. ZIP landet in deinem Downloads-Ordner.
8. Agent ruft `ingest_bundle({ zip_path, slug })` auf → entpackt nach `.design/handoff/<slug>/`.

**Wichtig zum aktuellen Bundle-Format (Stand April 2026):**
Claude Design liefert beim **Download as .zip** nur `*.html` + `*.jsx`-Dateien (Komponenten + Canvas), kein klassisches `spec.json`. Wenn du explizit ein strukturiertes Spec-Bundle willst, nimm im Export-Menü stattdessen **Handoff to Claude Code…**.

---

## 5. Workflow B — Bestehendes Bundle importieren

Wenn du die ZIP bereits hast (z. B. weil du außerhalb von Cursor designt hast):

```
/import-claude-design /pfad/zur/design-export.zip
```

Oder per CLI direkt:

```bash
cdc ingest /pfad/zur/design-export.zip --slug login-screen
```

---

## 6. Implementierung im Frontend

Sobald das Bundle in `.design/handoff/<slug>/` liegt, schreibe im Chat:

```
implementiere .design/handoff/login-screen gegen packages/frontend
```

Die `design-handoff.mdc`-Regel attached automatisch den `import-claude-design`-Skill, der die folgenden Schritte abarbeitet:

1. **Bundle inspizieren** (`inspect_bundle`, `read_readme`, `read_tokens`, `read_spec` via MCP)
2. **Token-Reconciliation** gegen die existierende CSS / Tailwind-Config — Brand-Farben gewinnen, Claude-Design-Tokens ergänzen nur, wo sie nicht kollidieren
3. **Komponenten generieren**, dabei **bestehende Library wiederverwenden** (z. B. `<Button>`, `<Modal>` werden nicht neu erfunden)
4. **Assets** selektiv kopieren (nur was tatsächlich gebraucht wird)
5. **Interaktionen** an bestehende Services binden (API-Calls, Stores, i18n)
6. **Lint + Build** laufen lassen

---

## 7. Watcher (optional)

Wenn du oft Designs exportierst, lass die Bridge im Hintergrund den Downloads-Ordner überwachen:

```bash
cdc watch ~/Downloads
# oder ein anderer Ordner:
cdc watch --dir /mnt/c/Users/<user>/Downloads
```

Jede neue ZIP, deren Name `claude-design` oder `design-export` enthält, wird automatisch ins aktuelle Projekt ingestiert.

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

## 9. Troubleshooting

| Symptom | Ursache | Fix |
|---|---|---|
| `cdc: command not found` | npm prefix nicht im PATH | siehe Abschnitt 1 (WSL-Spezialfall) |
| Slash-Commands erscheinen nicht | `.cursor/`-Files nicht da | `cdc init` im Projekt-Root erneut |
| MCP-Tools fehlen im Chat | Cursor nicht reloaded | Reload Window |
| `unzip not found` | System-Tool fehlt | Paketmanager-Install |
| Browser landet auf Login-Loop | Pro/Max-Account fehlt | Subscription kaufen |
| Generierung bricht ab | `Stop`-Button gedrückt oder Quota erreicht | erneut sendenden, ggf. einfacheren Prompt |
| ZIP-Download nicht gefunden | Browser speichert in unerwarteten Pfad | manueller Pfad: `/import-claude-design <absoluter-pfad>` |
| `cdc ingest` schlägt mit "missing spec.json" fehl | Du hast „Download as .zip" statt „Handoff to Claude Code" gewählt | im Export-Menü **Handoff to Claude Code…** verwenden, oder das Bundle manuell nach `.design/handoff/<slug>/` kopieren |

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

- Push **Cursor → Claude Design** (kein Reverse-Sync; nutze stattdessen Claude Designs „Web capture" gegen euren laufenden Dev-Server)
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
└── README.md
```
