#!/usr/bin/env node
// claude-design-cursor-bridge CLI
// Subcommands: init | ingest | watch | doctor | --help
//
// init     install .cursor skills/commands/rule + scripts/ingest into a target project
// ingest   unpack a Claude Design .zip into <project>/.design/handoff/<slug>/
// watch    watch a downloads dir and auto-ingest any new claude-design-*.zip
// doctor   verify a target project has the bridge installed and dirs are sane

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..');
const TEMPLATES = join(PKG_ROOT, 'templates');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
const log = {
  info: (m) => console.log(`${ANSI.cyan}•${ANSI.reset} ${m}`),
  ok: (m) => console.log(`${ANSI.green}✓${ANSI.reset} ${m}`),
  warn: (m) => console.log(`${ANSI.yellow}!${ANSI.reset} ${m}`),
  err: (m) => console.error(`${ANSI.red}✗${ANSI.reset} ${m}`),
  hr: () => console.log(`${ANSI.dim}────────────────────────────────────────────────${ANSI.reset}`),
};

const HELP = `
${ANSI.bold}claude-design-cursor-bridge${ANSI.reset}  ${ANSI.dim}Bridge claude.ai/design into any Cursor project${ANSI.reset}

${ANSI.bold}USAGE${ANSI.reset}
  cdc <command> [options]

${ANSI.bold}COMMANDS${ANSI.reset}
  init [path]               Install .cursor skills/commands/rule + ingest script into a project
                            (default path: cwd)
                            options:
                              --framework <next|vite-react|vue|svelte|generic>
                              --force                 overwrite existing files
                              --no-rule               skip writing .cursor/rules/design-handoff.mdc
                              --no-mcp                skip registering MCP server in .cursor/mcp.json
                              --components-dir <p>    override detected components dir
                              --tokens-file <p>       override detected tokens file
                              --lint <cmd>            lint command (e.g. "pnpm lint")
                              --build <cmd>           build command (e.g. "pnpm build")

  ingest <zip> [project]    Unpack a Claude Design .zip into <project>/.design/handoff/<slug>/
                            options:
                              --slug <slug>           override slug (default: derived from zip)
                              --force                 overwrite existing slug dir

  watch [project]           Watch ~/Downloads (or --dir) and auto-ingest claude-design-*.zip
                            options:
                              --dir <path>            watch dir (default: ~/Downloads)
                              --pattern <regex>       file pattern (default: ^claude-design.*\\.zip$)

  doctor [project]          Verify install + show framework + paths it would use

  --help, -h                Show this help
  --version, -v             Show version

${ANSI.bold}TYPICAL FLOW${ANSI.reset}
  cd ~/projects/my-app
  npx claude-design-cursor-bridge init
  # in Cursor:  /claude-design   → opens claude.ai/design via browser MCP, exports zip
  # or manual:  download .zip → cdc ingest ~/Downloads/foo.zip
  # in Cursor:  /import-claude-design → agent builds against your repo

${ANSI.dim}Docs: see README.md in this package${ANSI.reset}
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--') || next.startsWith('-')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else if (a.startsWith('-')) {
      flags[a.slice(1)] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function readPkgJson(dir) {
  const p = join(dir, 'package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function detectFramework(projectRoot) {
  const pkg = readPkgJson(projectRoot);
  const deps = pkg ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } : {};

  if (deps.next) return 'next';
  if (deps['@sveltejs/kit'] || deps.svelte) return 'svelte';
  if (deps.nuxt || deps.vue) return 'vue';
  if (deps.vite && (deps.react || deps['react-dom'])) return 'vite-react';
  if (deps.react || deps['react-dom']) return 'vite-react';
  return 'generic';
}

function frameworkDefaults(fw) {
  switch (fw) {
    case 'next':
      return {
        components: 'components',
        pages: 'app',
        services: 'lib',
        tokens: 'app/globals.css',
        i18n: 'i18n',
        lint: 'pnpm lint',
        build: 'pnpm build',
        dev: 'pnpm dev',
      };
    case 'svelte':
      return {
        components: 'src/lib/components',
        pages: 'src/routes',
        services: 'src/lib',
        tokens: 'src/app.css',
        i18n: 'src/lib/i18n',
        lint: 'pnpm lint',
        build: 'pnpm build',
        dev: 'pnpm dev',
      };
    case 'vue':
      return {
        components: 'src/components',
        pages: 'src/views',
        services: 'src/services',
        tokens: 'src/assets/main.css',
        i18n: 'src/i18n',
        lint: 'pnpm lint',
        build: 'pnpm build',
        dev: 'pnpm dev',
      };
    case 'vite-react':
      return {
        components: 'src/components',
        pages: 'src/pages',
        services: 'src/services',
        tokens: 'src/index.css',
        i18n: 'src/i18n',
        lint: 'npm run lint',
        build: 'npm run build',
        dev: 'npm run dev',
      };
    default:
      return {
        components: 'src/components',
        pages: 'src/pages',
        services: 'src/services',
        tokens: 'src/styles/tokens.css',
        i18n: 'src/i18n',
        lint: 'echo "no lint configured"',
        build: 'echo "no build configured"',
        dev: 'echo "no dev configured"',
      };
  }
}

function probeProjectPaths(projectRoot, defaults) {
  // Walk a couple of common monorepo layouts and prefer existing dirs.
  const candidates = {
    components: [
      defaults.components,
      'packages/frontend/src/components',
      'apps/web/components',
      'apps/web/src/components',
      'frontend/src/components',
      'web/src/components',
    ],
    tokens: [
      defaults.tokens,
      'packages/frontend/src/index.css',
      'apps/web/app/globals.css',
      'apps/web/src/index.css',
      'frontend/src/index.css',
      'web/src/index.css',
      'src/index.css',
      'src/styles/tokens.css',
    ],
    pages: [
      defaults.pages,
      'packages/frontend/src/pages',
      'apps/web/app',
      'apps/web/src/pages',
    ],
    services: [
      defaults.services,
      'packages/frontend/src/services',
      'apps/web/lib',
      'apps/web/src/services',
    ],
    i18n: [
      defaults.i18n,
      'packages/frontend/src/i18n',
      'apps/web/i18n',
      'apps/web/src/i18n',
    ],
  };
  const picked = {};
  for (const [key, list] of Object.entries(candidates)) {
    picked[key] = list.find((p) => existsSync(join(projectRoot, p))) ?? list[0];
  }
  return picked;
}

function renderTemplate(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}

function copyTemplateTree(srcDir, destDir, vars, { force }) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyTemplateTree(src, dest, vars, { force });
    } else {
      if (existsSync(dest) && !force) {
        log.warn(`exists, skipping (use --force to overwrite): ${relative(process.cwd(), dest)}`);
        continue;
      }
      const ext = extname(entry.name).toLowerCase();
      const isText = ['.md', '.mdc', '.mjs', '.json', '.txt', ''].includes(ext);
      if (isText) {
        const raw = readFileSync(src, 'utf8');
        writeFileSync(dest, renderTemplate(raw, vars));
      } else {
        copyFileSync(src, dest);
      }
    }
  }
}

function ensureMcpJson(projectRoot, force) {
  const mcpPath = join(projectRoot, '.cursor', 'mcp.json');
  const serverName = 'claude-design-bridge';
  const serverPath = join(PKG_ROOT, 'bin', 'cdc-mcp.mjs');
  const entry = {
    command: 'node',
    args: [serverPath],
  };

  let cfg = { mcpServers: {} };
  if (existsSync(mcpPath)) {
    const cur = readJson(mcpPath);
    if (cur && typeof cur === 'object') cfg = cur;
    if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
  }

  if (cfg.mcpServers[serverName] && !force) {
    log.warn(`.cursor/mcp.json already has '${serverName}' (use --force to overwrite)`);
    return;
  }
  cfg.mcpServers[serverName] = entry;
  mkdirSync(dirname(mcpPath), { recursive: true });
  writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + '\n');
  log.ok(`registered MCP server '${serverName}' in .cursor/mcp.json`);
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function ensureGitignoreEntries(projectRoot) {
  const giPath = join(projectRoot, '.gitignore');
  const block = [
    '',
    '# Claude Design handoff bundles (managed by claude-design-cursor-bridge)',
    '.design/handoff/**/*.zip',
    '.design/handoff/**/assets/**',
    '.design/handoff/**/preview/**',
    '',
  ].join('\n');
  if (!existsSync(giPath)) {
    writeFileSync(giPath, block.trimStart());
    log.ok('wrote .gitignore');
    return;
  }
  const cur = readFileSync(giPath, 'utf8');
  if (cur.includes('.design/handoff/**/*.zip')) {
    log.info('.gitignore already covers .design/handoff/**');
    return;
  }
  writeFileSync(giPath, cur + block);
  log.ok('appended .design/handoff rules to .gitignore');
}

function cmdInit(positional, flags) {
  const projectRoot = resolve(positional[0] ?? process.cwd());
  if (!existsSync(projectRoot)) {
    log.err(`project path does not exist: ${projectRoot}`);
    process.exit(2);
  }

  const fw = flags.framework ?? detectFramework(projectRoot);
  const defaults = frameworkDefaults(fw);
  const probed = probeProjectPaths(projectRoot, defaults);

  const vars = {
    framework: fw,
    components_dir: flags['components-dir'] ?? probed.components,
    tokens_file: flags['tokens-file'] ?? probed.tokens,
    pages_dir: probed.pages,
    services_dir: probed.services,
    i18n_dir: probed.i18n,
    lint_cmd: flags.lint ?? defaults.lint,
    build_cmd: flags.build ?? defaults.build,
    dev_cmd: defaults.dev,
  };

  log.hr();
  log.info(`project       ${projectRoot}`);
  log.info(`framework     ${fw}`);
  log.info(`components    ${vars.components_dir}`);
  log.info(`tokens        ${vars.tokens_file}`);
  log.info(`pages         ${vars.pages_dir}`);
  log.info(`services      ${vars.services_dir}`);
  log.info(`i18n          ${vars.i18n_dir}`);
  log.info(`lint          ${vars.lint_cmd}`);
  log.info(`build         ${vars.build_cmd}`);
  log.hr();

  const force = !!flags.force;

  // .cursor/{skills,commands,rules}
  copyTemplateTree(
    join(TEMPLATES, 'cursor', 'skills'),
    join(projectRoot, '.cursor', 'skills'),
    vars,
    { force },
  );
  copyTemplateTree(
    join(TEMPLATES, 'cursor', 'commands'),
    join(projectRoot, '.cursor', 'commands'),
    vars,
    { force },
  );
  if (!flags['no-rule']) {
    copyTemplateTree(
      join(TEMPLATES, 'cursor', 'rules'),
      join(projectRoot, '.cursor', 'rules'),
      vars,
      { force },
    );
  }

  // .design/handoff/
  copyTemplateTree(
    join(TEMPLATES, 'design'),
    join(projectRoot, '.design'),
    vars,
    { force },
  );

  // scripts/ingest-claude-design.mjs
  mkdirSync(join(projectRoot, 'scripts'), { recursive: true });
  copyTemplateTree(
    join(TEMPLATES, 'scripts'),
    join(projectRoot, 'scripts'),
    vars,
    { force },
  );

  ensureGitignoreEntries(projectRoot);
  if (!flags['no-mcp']) {
    ensureMcpJson(projectRoot, !!force);
  }

  log.hr();
  log.ok('install complete');
  console.log(`
Next:
  1. Open the project in Cursor.
  2. In the agent chat, run:  /claude-design   (browser-driven generation)
     or, if you already have a .zip:  /import-claude-design
  3. Manual ingest from terminal:
       node scripts/ingest-claude-design.mjs <path-to-zip>
`);
}

function deriveSlug(filePath) {
  return basename(filePath, extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function walkCount(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) n += walkCount(p);
    else n += 1;
  }
  return n;
}

function hasUnzip() {
  const r = spawnSync('unzip', ['-v'], { stdio: 'ignore' });
  return r.status === 0;
}

function ingestZip(zipPath, projectRoot, { slug, force }) {
  if (!existsSync(zipPath) || !statSync(zipPath).isFile()) {
    log.err(`not a file: ${zipPath}`);
    return 2;
  }
  if (extname(zipPath).toLowerCase() !== '.zip') {
    log.err(`not a .zip: ${zipPath}`);
    return 2;
  }
  if (!hasUnzip()) {
    log.err("'unzip' not found on PATH. Install it (Debian/Ubuntu: sudo apt install unzip; macOS: brew install unzip) and re-run.");
    return 2;
  }

  const finalSlug = slug ?? deriveSlug(zipPath);
  const dest = join(projectRoot, '.design', 'handoff', finalSlug);

  if (existsSync(dest)) {
    if (!force) {
      log.err(`destination exists: ${dest} (use --force to overwrite)`);
      return 4;
    }
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dest, { recursive: true });

  const unzip = spawnSync('unzip', ['-q', '-o', zipPath, '-d', dest], { stdio: 'inherit' });
  if (unzip.status !== 0) {
    log.err(`unzip failed (exit ${unzip.status})`);
    return 2;
  }

  const required = ['spec.json', 'design-tokens.json', 'README.md'];
  const missing = required.filter((f) => !existsSync(join(dest, f)));
  if (missing.length) {
    log.warn(`bundle missing required files: ${missing.join(', ')}`);
    log.warn(`unpacked anyway to: ${dest}`);
    log.warn('Anthropic may have changed the bundle layout. Update the skill before consuming.');
    return 3;
  }

  const manifest = readJson(join(dest, 'manifest.json')) ?? {};
  const spec = readJson(join(dest, 'spec.json')) ?? {};
  const tokens = readJson(join(dest, 'design-tokens.json')) ?? {};

  const componentCount = Array.isArray(spec.components)
    ? spec.components.length
    : (spec.tree && countNodes(spec.tree)) || 0;
  const tokenGroups = Object.keys(tokens).length;
  const assetsDir = join(dest, 'assets');
  const assetCount = existsSync(assetsDir) ? walkCount(assetsDir) : 0;

  const rel = relative(projectRoot, dest) || dest;
  console.log(`
  ${ANSI.bold}Claude Design bundle ingested${ANSI.reset}
  ─────────────────────────────
  slug                 ${finalSlug}
  destination          ${rel}
  source project       ${manifest.source_project ?? '(unknown)'}
  claude_design_ver    ${manifest.claude_design_version ?? '(unknown)'}
  target route         ${manifest.target_route ?? '(unspecified)'}
  components           ${componentCount}
  token groups         ${tokenGroups}
  assets               ${assetCount}

  Next: in Cursor, run /import-claude-design (or read .cursor/skills/import-claude-design/SKILL.md)
`);
  return 0;
}

function countNodes(node) {
  if (!node || typeof node !== 'object') return 0;
  let n = 1;
  const children = node.children ?? node.nodes ?? [];
  for (const c of children) n += countNodes(c);
  return n;
}

function cmdIngest(positional, flags) {
  if (!positional[0]) {
    log.err('missing <zip> argument');
    process.exit(1);
  }
  const zipPath = resolve(positional[0]);
  const projectRoot = resolve(positional[1] ?? process.cwd());
  process.exit(ingestZip(zipPath, projectRoot, { slug: flags.slug, force: !!flags.force }));
}

function cmdWatch(positional, flags) {
  const projectRoot = resolve(positional[0] ?? process.cwd());
  const watchDir = resolve(flags.dir ?? join(process.env.HOME ?? '/root', 'Downloads'));
  const pattern = new RegExp(flags.pattern ?? '^claude-design.*\\.zip$', 'i');

  if (!existsSync(watchDir)) {
    log.err(`watch dir does not exist: ${watchDir}`);
    process.exit(2);
  }

  log.info(`watching ${watchDir} for /${pattern.source}/`);
  log.info(`target project: ${projectRoot}`);
  log.info('press Ctrl-C to stop');

  const seen = new Set(readdirSync(watchDir));

  watch(watchDir, { persistent: true }, (eventType, filename) => {
    if (!filename) return;
    if (!pattern.test(filename)) return;
    if (seen.has(filename)) return;
    seen.add(filename);

    const full = join(watchDir, filename);
    // file may still be writing — wait for size to stabilise
    setTimeout(() => {
      if (!existsSync(full)) return;
      log.ok(`new bundle: ${filename}`);
      ingestZip(full, projectRoot, { slug: undefined, force: true });
    }, 1500);
  });
}

function cmdDoctor(positional) {
  const projectRoot = resolve(positional[0] ?? process.cwd());
  log.hr();
  log.info(`project ${projectRoot}`);
  const fw = detectFramework(projectRoot);
  log.info(`framework (auto): ${fw}`);
  const defaults = frameworkDefaults(fw);
  const probed = probeProjectPaths(projectRoot, defaults);
  for (const [k, v] of Object.entries(probed)) {
    const exists = existsSync(join(projectRoot, v));
    (exists ? log.ok : log.warn)(`${k.padEnd(11)} ${v}${exists ? '' : '  (not found)'}`);
  }
  log.hr();
  const checks = [
    '.cursor/skills/claude-design-browser/SKILL.md',
    '.cursor/skills/import-claude-design/SKILL.md',
    '.cursor/commands/claude-design.md',
    '.cursor/commands/import-claude-design.md',
    'scripts/ingest-claude-design.mjs',
    '.design/handoff/README.md',
  ];
  for (const f of checks) {
    const ok = existsSync(join(projectRoot, f));
    (ok ? log.ok : log.err)(f);
  }
  log.hr();
  if (hasUnzip()) {
    log.ok("system tool: 'unzip' available");
  } else {
    log.err("system tool: 'unzip' missing — install before running ingest (apt install unzip / brew install unzip)");
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(HELP);
    process.exit(0);
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    const pkg = readPkgJson(PKG_ROOT) ?? { version: '0.0.0' };
    console.log(pkg.version);
    process.exit(0);
  }
  const cmd = argv[0];
  const { positional, flags } = parseArgs(argv.slice(1));
  switch (cmd) {
    case 'init':
      return cmdInit(positional, flags);
    case 'ingest':
      return cmdIngest(positional, flags);
    case 'watch':
      return cmdWatch(positional, flags);
    case 'doctor':
      return cmdDoctor(positional);
    default:
      log.err(`unknown command: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}

main();
