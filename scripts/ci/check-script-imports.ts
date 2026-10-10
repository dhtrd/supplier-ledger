/**
 * The Node scripts (backup, maintenance, import) run TypeScript directly with
 * Node's type stripping, which — unlike Vite — only resolves relative imports
 * written with their file extension. A source module without extensions that
 * a script reaches breaks the nightly backup at load time (2026-10-10).
 *
 * This walks every relative import reachable from scripts/ and fails if one
 * does not name an existing file exactly. Type-only imports are erased by
 * Node and are skipped. No network, no credentials.
 *
 *   node scripts/ci/check-script-imports.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const IMPORT = /^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm;

function entryFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return entryFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

const seen = new Set<string>();
const problems: string[] = [];
const queue = entryFiles(join(root, 'scripts'));

while (queue.length) {
  const file = queue.pop()!;
  if (seen.has(file)) continue;
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT)) {
    if (m[2]) continue; // `import type … from` is erased at run time
    const spec = m[3]!;
    const target = resolve(dirname(file), spec);
    if (!/\.(ts|js|mjs|json)$/.test(spec) || !existsSync(target)) {
      problems.push(`${relative(root, file)}: '${spec}'`);
      continue;
    }
    if (target.endsWith('.ts')) queue.push(target);
  }
}

if (problems.length) {
  console.error(
    'Imports Node cannot resolve (add the .ts extension, or keep the module import-free):',
  );
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`script imports OK (${seen.size} files)`);
