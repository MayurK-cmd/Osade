#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fetch the substrate's source into `backend/` — OSADE.md §4.1, ADR 0002.
 *
 * `backend/` stays committed (ADR 0002); this restores it if it is deleted, and is how the pin
 * moves at the next substrate bump. Nothing builds on it.
 *
 * Pinned to the commit `backend/` **is**, so running this reproduces the tree Osade's `file:line`
 * citations were written against rather than shifting them.
 *
 * **Pinned to a commit, not a tag.** A tag can be moved; a commit sha is the content. GitHub's
 * codeload serves an archive for any sha, so asking for the sha *is* the verification — there is
 * no tarball checksum here because a tarball hash would be a hash of GitHub's compression
 * settings, which they explicitly decline to keep stable.
 *
 *   node scripts/fetch-herdr-source.mjs [--force]
 */

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BACKEND = join(ROOT, 'backend');

/** The herdr Osade reads. Bump alongside `vendor/herdr/<version>-p<protocol>/`. */
const PIN = {
  repository: 'herdrdev/herdr',
  // The commit `backend/` actually is — established by comparing every tracked blob hash
  // against the upstream tree (all 1766 identical). Not the v0.8.2 tag: the source is ahead of
  // the binary, which is pinned separately in vendor/herdr/0.8.2-p20.
  commit: '94f6d9c0d9bb',
  committedAt: '2026-09-02',
};

function log(message) {
  process.stdout.write(`${message}\n`);
}

function main() {
  const force = process.argv.includes('--force');

  if (existsSync(BACKEND) && readdirSync(BACKEND).length > 0) {
    if (!force) {
      log(`backend/ already exists. Nothing to do — pass --force to replace it.`);
      log(`  pinned: ${PIN.repository}@${PIN.commit.slice(0, 12)} (${PIN.committedAt})`);
      return;
    }
    log('removing the existing backend/ …');
    rmSync(BACKEND, { recursive: true, force: true });
  }

  const url = `https://codeload.github.com/${PIN.repository}/tar.gz/${PIN.commit}`;
  const staging = join(ROOT, '.herdr-src');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  const archive = join(staging, 'herdr.tar.gz');
  log(`fetching ${PIN.repository}@${PIN.commit.slice(0, 12)} …`);
  execFileSync('curl', ['-sSL', '--fail', '-o', archive, url], { stdio: 'inherit' });

  log('extracting …');
  execFileSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'inherit' });

  // codeload names the top directory <repo>-<sha>.
  const extracted = readdirSync(staging).find((entry) => entry.startsWith('herdr-'));
  if (!extracted) throw new Error('the archive did not contain a herdr- directory');

  renameSync(join(staging, extracted), BACKEND);
  rmSync(staging, { recursive: true, force: true });

  // A marker, so anyone looking at a checkout can tell what they have without re-deriving it.
  writeFileSync(
    join(BACKEND, 'OSADE-PIN.json'),
    `${JSON.stringify({ ...PIN, fetched_at: new Date().toISOString().slice(0, 10) }, null, 2)}\n`,
  );

  log(`backend/ is ${PIN.repository}@${PIN.commit.slice(0, 12)} (${PIN.committedAt}).`);
  log('It is read-only reference. Changes herdr needs go in patches/ (see patches/README.md).');
}

main();
