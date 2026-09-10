#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Download the pinned herdr binaries and verify them — OSADE.md §18.1.
 *
 * The binaries are **not committed**: ~91 MB across five platforms, which git stores badly and
 * every clone would pay for. What is committed is the thing that matters — a sha256 per asset in
 * `pin.json`, captured from what GitHub actually served. This fetches and checks against those.
 *
 * A checksum mismatch is fatal and the file is deleted rather than left on disk, because a
 * half-verified binary that stays around is one a later step will happily use.
 *
 *   node scripts/fetch-herdr-binaries.mjs [--all]
 *
 * Without `--all` it fetches only this machine's platform, which is what a developer needs.
 * Packaging wants `--all`.
 *
 * **This is not the only gate.** §4.1.1's boot drift check runs regardless, because a matching
 * checksum says the file is the one we pinned and says nothing about the herdr a user has on
 * their PATH.
 */

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PIN_DIR = join(ROOT, 'vendor', 'herdr', '0.8.2-p20');
const pin = JSON.parse(readFileSync(join(PIN_DIR, 'pin.json'), 'utf8'));

const RELEASE = 'https://github.com/herdrdev/herdr/releases/download/v0.8.2';

/** node's platform/arch to the asset that serves it. */
function assetForThisMachine() {
  const key = `${process.platform}-${process.arch}`;
  return {
    'linux-x64': 'herdr-linux-x86_64',
    'linux-arm64': 'herdr-linux-aarch64',
    'darwin-x64': 'herdr-macos-x86_64',
    'darwin-arm64': 'herdr-macos-aarch64',
    'win32-x64': 'herdr-windows-x86_64.zip',
  }[key];
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Unpack a zip with whatever this machine has.
 *
 * Both commands are run from inside the target with a bare filename: GNU tar reads `C:\path` as
 * a remote `host:path` and answers "Cannot connect to C: resolve failed". It also cannot read
 * zip at all, which is why `unzip` is tried first — bsdtar (macOS, and Windows' own tar.exe) can,
 * so it is a real fallback rather than a second guess.
 */
function unzip(name, target) {
  try {
    execFileSync('unzip', ['-o', '-q', name], { cwd: target });
    return;
  } catch {
    execFileSync('tar', ['-xf', name], { cwd: target });
  }
}

function fetchOne(name) {
  const expected = pin.binary.assets[name];
  if (!expected) throw new Error(`${name} is not in pin.json`);

  const target = join(PIN_DIR, expected.target);
  mkdirSync(target, { recursive: true });
  const download = join(target, name);

  process.stdout.write(`${name} … `);
  execFileSync('curl', ['-sSL', '--fail', '-o', download, `${RELEASE}/${name}`]);

  const actual = sha256(download);
  if (actual !== expected.sha256) {
    rmSync(download, { force: true });
    throw new Error(
      `checksum mismatch for ${name}\n  expected ${expected.sha256}\n  got      ${actual}\n` +
        `The download was deleted. Either the release was re-cut or something is wrong.`,
    );
  }

  if (name.endsWith('.zip')) {
    unzip(name, target);
    rmSync(download, { force: true });
    for (const [inner, innerHash] of Object.entries(expected.contains ?? {})) {
      const innerPath = join(target, inner);
      const got = sha256(innerPath);
      if (got !== innerHash) {
        rmSync(innerPath, { force: true });
        throw new Error(`checksum mismatch for ${inner} inside ${name}: got ${got}`);
      }
    }
  } else {
    // The bare assets are the executable itself; give it the name everything expects.
    renameSync(download, join(target, 'herdr'));
  }

  process.stdout.write('ok\n');
}

function main() {
  const all = process.argv.includes('--all');
  const names = all ? Object.keys(pin.binary.assets) : [assetForThisMachine()];

  if (!names[0]) {
    throw new Error(`no herdr release for ${process.platform}-${process.arch}`);
  }

  for (const name of names) fetchOne(name);

  process.stdout.write(
    `\nverified against vendor/herdr/0.8.2-p20/pin.json.\n` +
      `The boot drift check (OSADE.md §4.1.1) still runs — this says nothing about the herdr on PATH.\n`,
  );
  if (!all && !existsSync(join(PIN_DIR, 'third-party'))) {
    process.stdout.write('note: third-party notices are missing from the pin directory.\n');
  }
}

main();
