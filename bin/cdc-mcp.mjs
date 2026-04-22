#!/usr/bin/env node
// claude-design-cursor-bridge MCP server (stdio).
// Exposes the deterministic parts of the bridge as MCP tools so any
// MCP-aware client (Cursor, Claude Code, Windsurf, Cline, Codex) can
// call them directly without shelling out.
//
// Browser-driven generation is intentionally NOT here — that uses the
// host IDE's browser MCP (cursor-ide-browser) and stays as a Skill.
//
// Tools:
//   ingest_bundle    unpack a .zip into <project>/.design/handoff/<slug>/
//   list_bundles     list all unpacked bundles in the current project
//   inspect_bundle   manifest + counts for one bundle
//   read_spec        read spec.json for one bundle (parsed)
//   read_tokens      read design-tokens.json for one bundle (parsed)
//   read_readme      read README.md for one bundle (raw text)
//   doctor           verify project install + tool availability
//
// Working directory: the server resolves paths against either the
// `project_root` argument (if provided per call) or the cwd it was
// spawned in. Cursor spawns MCP servers from the workspace root.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, join, relative, resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const SERVER_NAME = 'claude-design-bridge';
const SERVER_VERSION = '0.1.0';

const projectRootArg = z
  .string()
  .optional()
  .describe('Absolute path to the project root. Defaults to the server cwd.');

const slugArg = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens')
  .describe('Bundle slug (subdirectory name under .design/handoff/).');

function resolveProjectRoot(arg) {
  return resolve(arg ?? process.cwd());
}

function deriveSlug(filePath) {
  return basename(filePath, extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function readJsonSafe(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

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

function hasUnzip() {
  return spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0;
}

function summarise(bundleDir) {
  const manifest = readJsonSafe(join(bundleDir, 'manifest.json')) ?? {};
  const spec = readJsonSafe(join(bundleDir, 'spec.json')) ?? {};
  const tokens = readJsonSafe(join(bundleDir, 'design-tokens.json')) ?? {};
  const componentCount = Array.isArray(spec.components)
    ? spec.components.length
    : (spec.tree && countNodes(spec.tree)) || 0;
  const tokenGroups = Object.keys(tokens).length;
  const assetsDir = join(bundleDir, 'assets');
  const assetCount = existsSync(assetsDir) ? walkCount(assetsDir) : 0;
  return {
    source_project: manifest.source_project ?? null,
    claude_design_version: manifest.claude_design_version ?? null,
    target_route: manifest.target_route ?? null,
    entrypoint: manifest.entrypoint ?? null,
    component_count: componentCount,
    token_groups: tokenGroups,
    asset_count: assetCount,
  };
}

function jsonResult(obj) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  };
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message, extra = {}) {
  const payload = { error: message, ...extra };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

// ---------------------------------------------------------------------------
// ingest_bundle
// ---------------------------------------------------------------------------
server.registerTool(
  'ingest_bundle',
  {
    title: 'Ingest a Claude Design .zip bundle',
    description:
      'Unpack a Claude Design handoff bundle (.zip exported from claude.ai/design) into <project_root>/.design/handoff/<slug>/. Validates that spec.json, design-tokens.json, README.md are present. Returns bundle summary on success.',
    inputSchema: {
      zip_path: z.string().describe('Absolute path to the .zip file.'),
      slug: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .optional()
        .describe('Override the slug (default: derived from zip filename).'),
      force: z
        .boolean()
        .optional()
        .describe('Overwrite if destination already exists.'),
      project_root: projectRootArg,
    },
  },
  async ({ zip_path, slug, force, project_root }) => {
    const projectRoot = resolveProjectRoot(project_root);
    const zipPath = resolve(zip_path);

    if (!existsSync(zipPath) || !statSync(zipPath).isFile()) {
      return errorResult(`not a file: ${zipPath}`);
    }
    if (extname(zipPath).toLowerCase() !== '.zip') {
      return errorResult(`not a .zip: ${zipPath}`);
    }
    if (!hasUnzip()) {
      return errorResult(
        "'unzip' not found on PATH. Install it (apt install unzip / brew install unzip) and retry.",
      );
    }

    const finalSlug = slug ?? deriveSlug(zipPath);
    const dest = join(projectRoot, '.design', 'handoff', finalSlug);

    if (existsSync(dest)) {
      if (!force) {
        return errorResult(`destination exists: ${dest}`, {
          hint: 'pass force=true to overwrite',
        });
      }
      rmSync(dest, { recursive: true, force: true });
    }
    mkdirSync(dest, { recursive: true });

    const r = spawnSync('unzip', ['-q', '-o', zipPath, '-d', dest]);
    if (r.status !== 0) {
      return errorResult(`unzip failed (exit ${r.status})`, {
        stderr: r.stderr?.toString() ?? null,
      });
    }

    const required = ['spec.json', 'design-tokens.json', 'README.md'];
    const missing = required.filter((f) => !existsSync(join(dest, f)));
    if (missing.length) {
      return errorResult(`bundle missing required files: ${missing.join(', ')}`, {
        unpacked_to: dest,
        hint: 'Anthropic may have changed the bundle layout. Update the import-claude-design skill before consuming.',
      });
    }

    return jsonResult({
      ok: true,
      slug: finalSlug,
      destination: relative(projectRoot, dest) || dest,
      destination_abs: dest,
      ...summarise(dest),
    });
  },
);

// ---------------------------------------------------------------------------
// list_bundles
// ---------------------------------------------------------------------------
server.registerTool(
  'list_bundles',
  {
    title: 'List all Claude Design bundles in this project',
    description:
      'Return all unpacked bundles under <project_root>/.design/handoff/ with summaries.',
    inputSchema: { project_root: projectRootArg },
  },
  async ({ project_root }) => {
    const projectRoot = resolveProjectRoot(project_root);
    const root = join(projectRoot, '.design', 'handoff');
    if (!existsSync(root)) {
      return jsonResult({ bundles: [], project_root: projectRoot });
    }
    const bundles = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const valid = ['spec.json', 'design-tokens.json'].every((f) =>
        existsSync(join(dir, f)),
      );
      bundles.push({
        slug: entry.name,
        path: relative(projectRoot, dir),
        valid,
        ...(valid ? summarise(dir) : {}),
      });
    }
    return jsonResult({ project_root: projectRoot, bundles });
  },
);

// ---------------------------------------------------------------------------
// inspect_bundle
// ---------------------------------------------------------------------------
server.registerTool(
  'inspect_bundle',
  {
    title: 'Inspect a single Claude Design bundle',
    description:
      'Return manifest + counts for one bundle by slug. Lighter than reading raw spec.json.',
    inputSchema: { slug: slugArg, project_root: projectRootArg },
  },
  async ({ slug, project_root }) => {
    const projectRoot = resolveProjectRoot(project_root);
    const dir = join(projectRoot, '.design', 'handoff', slug);
    if (!existsSync(dir)) return errorResult(`bundle not found: ${slug}`);
    return jsonResult({
      slug,
      path: relative(projectRoot, dir),
      ...summarise(dir),
    });
  },
);

// ---------------------------------------------------------------------------
// read_spec
// ---------------------------------------------------------------------------
server.registerTool(
  'read_spec',
  {
    title: 'Read spec.json for one bundle',
    description:
      'Return the parsed spec.json (component tree, layout, interactions) for one bundle. Use sparingly on large specs — prefer inspect_bundle for a summary.',
    inputSchema: { slug: slugArg, project_root: projectRootArg },
  },
  async ({ slug, project_root }) => {
    const projectRoot = resolveProjectRoot(project_root);
    const f = join(projectRoot, '.design', 'handoff', slug, 'spec.json');
    if (!existsSync(f)) return errorResult(`spec.json not found for slug: ${slug}`);
    const data = readJsonSafe(f);
    if (data === null) return errorResult(`spec.json is not valid JSON: ${f}`);
    return jsonResult(data);
  },
);

// ---------------------------------------------------------------------------
// read_tokens
// ---------------------------------------------------------------------------
server.registerTool(
  'read_tokens',
  {
    title: 'Read design-tokens.json for one bundle',
    description:
      'Return the parsed design-tokens.json (colors, typography, spacing, radii, shadows) for one bundle. Use during token reconciliation.',
    inputSchema: { slug: slugArg, project_root: projectRootArg },
  },
  async ({ slug, project_root }) => {
    const projectRoot = resolveProjectRoot(project_root);
    const f = join(projectRoot, '.design', 'handoff', slug, 'design-tokens.json');
    if (!existsSync(f))
      return errorResult(`design-tokens.json not found for slug: ${slug}`);
    const data = readJsonSafe(f);
    if (data === null)
      return errorResult(`design-tokens.json is not valid JSON: ${f}`);
    return jsonResult(data);
  },
);

// ---------------------------------------------------------------------------
// read_readme
// ---------------------------------------------------------------------------
server.registerTool(
  'read_readme',
  {
    title: "Read the bundle's README.md",
    description:
      "Return the raw README.md Anthropic ships in the bundle. Contains per-project notes the agent should honor before defaults.",
    inputSchema: { slug: slugArg, project_root: projectRootArg },
  },
  async ({ slug, project_root }) => {
    const projectRoot = resolveProjectRoot(project_root);
    const f = join(projectRoot, '.design', 'handoff', slug, 'README.md');
    if (!existsSync(f)) return errorResult(`README.md not found for slug: ${slug}`);
    return textResult(readFileSync(f, 'utf8'));
  },
);

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------
server.registerTool(
  'doctor',
  {
    title: 'Verify the project has the bridge installed',
    description:
      'Check that .cursor skills/commands/rule, scripts/ingest, .design/handoff exist; check that unzip is on PATH; report bundle count.',
    inputSchema: { project_root: projectRootArg },
  },
  async ({ project_root }) => {
    const projectRoot = resolveProjectRoot(project_root);
    const checks = {
      '.cursor/skills/claude-design-browser/SKILL.md': false,
      '.cursor/skills/import-claude-design/SKILL.md': false,
      '.cursor/commands/claude-design.md': false,
      '.cursor/commands/import-claude-design.md': false,
      '.cursor/rules/design-handoff.mdc': false,
      'scripts/ingest-claude-design.mjs': false,
      '.design/handoff/README.md': false,
    };
    for (const k of Object.keys(checks)) {
      checks[k] = existsSync(join(projectRoot, k));
    }
    const handoffDir = join(projectRoot, '.design', 'handoff');
    const bundleCount = existsSync(handoffDir)
      ? readdirSync(handoffDir, { withFileTypes: true }).filter((e) => e.isDirectory())
          .length
      : 0;
    const installed = Object.values(checks).every(Boolean);
    return jsonResult({
      project_root: projectRoot,
      installed,
      checks,
      unzip_available: hasUnzip(),
      bundle_count: bundleCount,
    });
  },
);

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
process.on('SIGINT', () => server.close().then(() => process.exit(0)));
process.on('SIGTERM', () => server.close().then(() => process.exit(0)));
console.error(`[${SERVER_NAME} v${SERVER_VERSION}] ready on stdio`);
