/**
 * @file verify-modules.mjs
 * @description Static integrity check across every source module.
 *
 * With no build step there is no compiler to catch a renamed export or a typo
 * in a relative path — the failure arrives as a blank page in the browser. This
 * script is the substitute: it parses every file, resolves every relative
 * import, and confirms the named bindings actually exist in the target module.
 *
 * Run: npm run verify
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JS_ROOT = join(ROOT, 'js');

/** @returns {string[]} Every .js file under a directory, recursively. */
function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (entry.endsWith('.js')) found.push(path);
  }
  return found;
}

const files = walk(JS_ROOT).sort();
/** @type {string[]} */
const problems = [];

/**
 * Removes comments before scanning.
 *
 * Without this, prose that mentions an import — and this codebase's doc
 * comments do discuss module choices — is read as a real import and reported as
 * a missing file. Replacing comment bodies with blank space rather than
 * deleting them keeps byte offsets stable for any future line reporting.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length));
}

/** Regexes are sufficient here: the codebase uses a single consistent style. */
const IMPORT_RE = /import\s+(?:([\w*\s{},$]+?)\s+from\s+)?['"]([^'"]+)['"]/g;
const NAMED_EXPORT_RE = /^export\s+(?:async\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]+)\}/gm;
const DEFAULT_EXPORT_RE = /^export\s+default\b/m;

/** @type {Map<string, {named: Set<string>, hasDefault: boolean, source: string}>} */
const modules = new Map();

for (const file of files) {
  const source = stripComments(readFileSync(file, "utf8"));
  const named = new Set();

  for (const match of source.matchAll(NAMED_EXPORT_RE)) named.add(match[1]);
  for (const match of source.matchAll(EXPORT_LIST_RE)) {
    for (const part of match[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias) named.add(alias);
    }
  }
  modules.set(file, { named, hasDefault: DEFAULT_EXPORT_RE.test(source), source });
}

for (const [file, module] of modules) {
  const shortPath = relative(ROOT, file);

  for (const match of module.source.matchAll(IMPORT_RE)) {
    const [, clause, specifier] = match;
    if (!specifier.startsWith('.')) continue;   // Bare specifiers: none expected.

    const target = resolve(dirname(file), specifier);
    if (!existsSync(target)) {
      problems.push(`${shortPath}: imports "${specifier}" which does not exist`);
      continue;
    }
    if (!clause) continue;                       // Side-effect import.

    const targetModule = modules.get(target);
    if (!targetModule) continue;                 // Outside js/ — not our concern.

    const braces = clause.match(/\{([^}]*)\}/);
    if (!braces) continue;                       // Default or namespace import.

    for (const rawName of braces[1].split(',')) {
      const name = rawName.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (!targetModule.named.has(name)) {
        problems.push(`${shortPath}: imports { ${name} } from "${specifier}" — not exported there`);
      }
    }
  }
}

// ---- Layering rule: dependencies point inward only ------------------------
/** Directory → the directories it is forbidden to import from. */
const FORBIDDEN = {
  'js/core': ['js/domain', 'js/data', 'js/scheduling', 'js/services', 'js/ui', 'js/managers', 'js/commands'],
  'js/domain': ['js/data', 'js/scheduling', 'js/services', 'js/ui', 'js/managers', 'js/commands'],
  'js/scheduling': ['js/data', 'js/services', 'js/ui', 'js/managers'],
  'js/services': ['js/ui'],
};

for (const [file, module] of modules) {
  const shortPath = relative(ROOT, file).replace(/\\/g, '/');
  const layer = Object.keys(FORBIDDEN).find((prefix) => shortPath.startsWith(`${prefix}/`));
  if (!layer) continue;

  for (const match of module.source.matchAll(IMPORT_RE)) {
    const specifier = match[2];
    if (!specifier.startsWith('.')) continue;

    const target = relative(ROOT, resolve(dirname(file), specifier)).replace(/\\/g, '/');
    const violated = FORBIDDEN[layer].find((banned) => target.startsWith(`${banned}/`));
    if (violated) {
      problems.push(`LAYERING — ${shortPath} imports from ${violated} (${specifier})`);
    }
  }
}

// ---- Syntax ----------------------------------------------------------------
// Parse every file for real. The import/export analysis above is regex-based
// and happily accepts code the engine will reject — a duplicate `const`, an
// unbalanced brace — and in a no-build-step app that reaches the user as a
// blank page, because one bad module takes the whole graph down. `node --check`
// is the compiler this project otherwise does not have.
await Promise.all(files.map(async (file) => {
  try {
    await execFileAsync(process.execPath, ['--check', file]);
  } catch (error) {
    const message = String(error.stderr ?? error.message)
      .split('\n')
      .find((line) => /Error|error:/.test(line)) ?? 'failed to parse';
    problems.push(`SYNTAX — ${relative(ROOT, file)}: ${message.trim()}`);
  }
}));

// ---- Report ---------------------------------------------------------------
console.log(`Checked ${files.length} modules under js/`);

if (problems.length === 0) {
  console.log('OK — every module parses, every import resolves, every named binding exists, layering is clean.');
  process.exit(0);
}

console.log(`\n${problems.length} problem(s):`);
for (const problem of problems) console.log(`  - ${problem}`);
process.exit(1);
