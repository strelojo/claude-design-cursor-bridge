#!/usr/bin/env node
// Standalone ingest of a Claude Design handoff bundle (.zip).
// Installed by `cdc init`. Equivalent to `cdc ingest <zip>` but works without
// the bridge CLI being on PATH — useful for CI / contributors who only cloned
// the project.
//
// Usage:
//   node scripts/ingest-claude-design.mjs <path-to-zip> [--slug <slug>] [--force]

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith('--')) {
  console.error('usage: node scripts/ingest-claude-design.mjs <path-to-zip> [--slug <slug>] [--force]');
  process.exit(1);
}

const zipPath = resolve(args[0]);
let slug = null;
let force = false;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--slug') slug = args[++i];
  else if (args[i] === '--force') force = true;
  else {
    console.error(`unknown argument: ${args[i]}`);
    process.exit(1);
  }
}

if (!existsSync(zipPath) || !statSync(zipPath).isFile() || extname(zipPath).toLowerCase() !== '.zip') {
  console.error(`not a .zip file: ${zipPath}`);
  process.exit(2);
}

if (!slug) {
  slug = basename(zipPath, extname(zipPath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const repoRoot = resolve(process.cwd());
const destRoot = join(repoRoot, '.design', 'handoff', slug);

if (existsSync(destRoot)) {
  if (!force) {
    console.error(`destination exists: ${destRoot} (re-run with --force to overwrite)`);
    process.exit(4);
  }
  rmSync(destRoot, { recursive: true, force: true });
}
mkdirSync(destRoot, { recursive: true });

const unzip = spawnSync('unzip', ['-q', '-o', zipPath, '-d', destRoot], { stdio: 'inherit' });
if (unzip.status !== 0) {
  console.error(`unzip failed (exit ${unzip.status})`);
  process.exit(2);
}

const required = ['spec.json', 'design-tokens.json', 'README.md'];
const missing = required.filter((f) => !existsSync(join(destRoot, f)));
if (missing.length > 0) {
  console.error(`bundle missing required files: ${missing.join(', ')}`);
  console.error(`unpacked to: ${destRoot}`);
  console.error('if Anthropic changed the bundle layout, update .cursor/skills/import-claude-design/SKILL.md before continuing');
  process.exit(3);
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const manifest = readJson(join(destRoot, 'manifest.json')) ?? {};
const spec = readJson(join(destRoot, 'spec.json')) ?? {};
const tokens = readJson(join(destRoot, 'design-tokens.json')) ?? {};

const componentCount = Array.isArray(spec.components)
  ? spec.components.length
  : (spec.tree && countNodes(spec.tree)) || 0;
const tokenGroups = Object.keys(tokens).length;
const assetsDir = join(destRoot, 'assets');
const assetCount = existsSync(assetsDir) ? walkCount(assetsDir) : 0;

console.log(`
  Claude Design bundle ingested
  ─────────────────────────────
  slug                 ${slug}
  destination          ${relative(repoRoot, destRoot) || destRoot}
  source project       ${manifest.source_project ?? '(unknown)'}
  claude_design_ver    ${manifest.claude_design_version ?? '(unknown)'}
  target route         ${manifest.target_route ?? '(unspecified)'}
  components           ${componentCount}
  token groups         ${tokenGroups}
  assets               ${assetCount}

  Next: in Cursor, run /import-claude-design
`);

function countNodes(node) {
  if (!node || typeof node !== 'object') return 0;
  let n = 1;
  const children = node.children ?? node.nodes ?? [];
  for (const c of children) n += countNodes(c);
  return n;
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
