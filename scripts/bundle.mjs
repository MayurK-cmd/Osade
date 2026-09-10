#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Bundle a workspace package to runnable JavaScript.
 *
 * Osade's packages resolve to TypeScript in development — `main` is `./src/index.ts`, which is
 * what lets vitest and vite-node run the tree with no build step. That is a good default and it
 * is why nothing was ever built: it works right up until something has to run under plain node,
 * at which point `bin` points at a `.ts` file and the Electron supervisor can only start the
 * daemon by shelling out to a dev runner.
 *
 * The split that makes both work:
 *
 * - **Workspace code is bundled.** `@osade/contract` resolves to `src/index.ts`, so leaving it
 *   external would produce a dist that loads TypeScript at runtime — which is exactly the
 *   failure this exists to remove.
 * - **Real dependencies stay external.** `better-sqlite3` is a native module and cannot be
 *   bundled at all; the rest are resolved from `node_modules` the way node expects.
 *
 * Externals come from the package's own `dependencies`, minus anything `workspace:*`, so adding
 * a dependency does not silently start bundling it.
 *
 *   node scripts/bundle.mjs <package-dir> <entry> <outfile>
 */

const [packageDir, entry, outfile] = process.argv.slice(2);
if (!packageDir || !entry || !outfile) {
  process.stderr.write('usage: node scripts/bundle.mjs <package-dir> <entry> <outfile>\n');
  process.exit(2);
}

const root = resolve(packageDir);
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const external = Object.entries(manifest.dependencies ?? {})
  .filter(([, range]) => !String(range).startsWith('workspace:'))
  .map(([name]) => name);

const result = await build({
  entryPoints: [join(root, entry)],
  outfile: join(root, outfile),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  // Node 22 has these; without the banner, esbuild's ESM output has no `require` for any
  // dependency that still reaches for one.
  banner: {
    js: [
      "import { createRequire as __osadeCreateRequire } from 'node:module';",
      'const require = __osadeCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'warning',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
process.stdout.write(
  `${manifest.name}: ${outfile} (${Math.round(bytes / 1024)} kB)\n` +
    `  external: ${external.join(', ') || '(none)'}\n`,
);
