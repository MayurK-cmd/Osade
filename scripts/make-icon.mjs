#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy the app mark into `build/icon.png` for electron-builder (.ico / .icns).
 *
 * Source of truth is `assets/osade.png`. The previous generator drew a ledger of rectangles;
 * the product mark is this file.
 *
 *   node scripts/make-icon.mjs
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets', 'osade.png');
if (!existsSync(src)) throw new Error(`missing app icon: ${src}`);

const out = join(root, 'build');
mkdirSync(out, { recursive: true });
const dest = join(out, 'icon.png');
copyFileSync(src, dest);
process.stdout.write(`wrote ${dest}\n`);
