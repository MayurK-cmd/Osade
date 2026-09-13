#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/**
 * Rename the substrate source in `backend/` into Osade's name.
 *
 * `backend/` is an Apache-2.0 upstream tree. The licence permits modifying and renaming it; what
 * it requires is that the licence and attribution travel with it (docs/THIRD-PARTY-NOTICES.md,
 * vendor/runtime/<pin>/LICENSE) and that changed files say they were changed. This script *is*
 * that statement of change: it is the only edit ever made to `backend/`, it is deterministic, and
 * `backend/OSADE-PIN.json` records that it ran.
 *
 * It is also rerunnable — `scripts/fetch-substrate-source.mjs` applies it to every fresh fetch,
 * and running it twice changes nothing.
 *
 *   node scripts/rebrand-source.mjs [dir]      (default: backend)
 *
 * What changes: every `herdr` / `Herdr` / `HERDR` in text, case preserved, and every file or
 * directory named with it. A word swap of equal length keeps every line and column where it
 * was, so the `backend/src/…:line` citations throughout Osade stay correct.
 *
 * What deliberately does not:
 *
 *   - **Real addresses.** URLs on real hosts, the project's domain, its GitHub organisation and
 *     third-party repositories. These are the source's update, install, docs and issue
 *     endpoints. Rewritten, they would point at domains and organisations Osade does not own —
 *     which someone else could register and serve an "update" from. Dummy hosts (example.com,
 *     loopback) carry no such risk and are renamed.
 *   - **`OSADE-PIN.json`**, the provenance record of what this tree is and where it came from.
 *   - **Two environment variables that would collide.** `HERDR_HOME` and `HERDR_SESSION` would
 *     become `OSADE_HOME` and `OSADE_SESSION`, names Osade itself sets. A runtime built from
 *     this source would then read Osade's own home directory as its own. They become
 *     `OSADE_RUNTIME_HOME` and `OSADE_RUNTIME_SESSION` instead.
 *   - Binary files, and build output.
 */

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// Relative to the repository, or absolute — the absolute form is how a copy outside the repo is
// checked against the committed tree.
const requested = process.argv[2] ?? 'backend';
const target = /^(?:[A-Za-z]:)?[\\/]/.test(requested) ? requested : join(ROOT, requested);

const SKIP_DIRS = new Set(['.git', 'target', 'node_modules', 'zig-pkg', 'zig-cache', '.zig-cache']);
const SKIP_FILES = new Set(['OSADE-PIN.json']);
const MAX_BYTES = 20 * 1024 * 1024;

/** Hosts that are placeholders by definition, so a URL on one points nowhere real. */
const DUMMY_HOST = /^(example\.(com|org|net)|[\w-]+\.(example|test|invalid|localhost)|localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)\]]+/gi;

/** Real addresses that are not URLs: the domain, the organisation, other people's repositories. */
const KEPT_TOKENS = [
  // Release file names. The kept manifests and download URLs point at files upstream publishes
  // under these names, so anything that builds or checks one — the updater's tests, the changelog
  // and preview tooling, the release workflows — has to spell it the same way. Renamed, they fail
  // against the very URLs they sit beside: found by running the tooling's tests before and after.
  /\bherdr-(?:linux|macos|windows)-(?:x86_64|aarch64|arm64)(?:\.zip|\.exe)?(?![\w-])/g,
  /\bherdr-(?=\{target\})/g,
  /removeprefix\('herdr-'\)/g,
  // The executable inside the published Windows zip, and the name the installer and self-updater
  // give it on disk. Not cargo's own output (`target\…\release\herdr.exe`), which follows the
  // package name and is renamed with it.
  /(?<![\\/](?:release|debug)[\\/])\bherdr\.exe\b/g,
  /\b(?:[a-z0-9-]+\.)*herdr\.dev\b/gi,
  /\bherdrdev\b(?:\/[\w.-]+)?/gi,
  /\b[\w.-]+\/herdr-plugin-examples\b/gi,
  /[\w.+-]+@(?:[\w-]+\.)*[\w-]*herdr[\w-]*\.[a-z]{2,}\b/gi,
];

const COLLIDING = [
  [/\bHERDR_HOME\b/g, 'OSADE_RUNTIME_HOME'],
  [/\bHERDR_SESSION\b/g, 'OSADE_RUNTIME_SESSION'],
];

function swap(text) {
  return text.replace(/HERDR/g, 'OSADE').replace(/Herdr/g, 'Osade').replace(/herdr/g, 'osade');
}

function hostOf(url) {
  // `file://` has no host to own — it is a local path, and a local path is renamed like any other.
  if (/^file:\/\//i.test(url)) return 'localhost';
  const afterScheme = url.slice(url.indexOf('://') + 3);
  const host = afterScheme.split(/[/?#]/)[0].replace(/^[^@]*@/, '');
  return host.replace(/:[^:\]]*$/, '');
}

const stats = { files: 0, replaced: 0, kept: 0, renamed: 0 };

function rebrandText(text) {
  // A private-use character marks a held token: it cannot occur in the source text, and unlike
  // NUL it is not a control character.
  const vault = [];
  const hold = (match) => `${vault.push(match) - 1}`;

  let out = text.replace(URL_PATTERN, (url) =>
    /herdr/i.test(url) && !DUMMY_HOST.test(hostOf(url)) ? hold(url) : url,
  );
  for (const pattern of KEPT_TOKENS) {
    out = out.replace(pattern, (match) => (/herdr/i.test(match) ? hold(match) : match));
  }
  stats.kept += vault.filter((token) => /herdr/i.test(token)).length;

  for (const [pattern, replacement] of COLLIDING) out = out.replace(pattern, replacement);
  out = swap(out);

  return out.replace(/(\d+)/g, (_, index) => vault[Number(index)]);
}

function isBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0);
}

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, visit);
      visit(path, true);
    } else {
      visit(path, false, stat);
    }
  }
}

function main() {
  if (!existsSync(target)) throw new Error(`${target} does not exist`);

  const paths = [];
  walk(target, (path, isDir, stat) => {
    paths.push(path);
    if (isDir || SKIP_FILES.has(basename(path)) || stat.size > MAX_BYTES) return;

    const buffer = readFileSync(path);
    if (isBinary(buffer)) return;

    const before = buffer.toString('utf8');
    if (!/herdr/i.test(before)) return;

    const after = rebrandText(before);
    if (after !== before) {
      stats.replaced += (before.match(/herdr/gi) ?? []).length - (after.match(/herdr/gi) ?? []).length;
      writeFileSync(path, after);
      stats.files += 1;
    }
  });

  // Deepest first, so renaming a directory never invalidates a path still to be renamed.
  for (const path of paths.sort((a, b) => b.length - a.length)) {
    const name = basename(path);
    if (!/herdr/i.test(name) || SKIP_FILES.has(name)) continue;
    renameSync(path, join(dirname(path), swap(name)));
    stats.renamed += 1;
  }

  process.stdout.write(
    `${relative(ROOT, target) || '.'}: ${stats.replaced} occurrences in ${stats.files} files, ` +
      `${stats.renamed} paths renamed, ${stats.kept} real addresses kept as they are\n`,
  );
}

main();
