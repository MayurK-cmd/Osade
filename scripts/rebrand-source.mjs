#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/**
 * Rename the substrate source in `backend/` into Osade's name.
 *
 * `backend/` is an Apache-2.0 upstream tree. The licence permits modifying and renaming it; what it
 * requires is that the licence and attribution travel with it (docs/THIRD-PARTY-NOTICES.md,
 * vendor/runtime/<pin>/LICENSE) and that changed files say they were changed. This script *is*
 * that statement of change: it is the only edit ever made to `backend/`, it is deterministic, and
 * `backend/OSADE-PIN.json` records that it ran. Running it twice changes nothing, and
 * `scripts/fetch-substrate-source.mjs` applies it to every fresh fetch.
 *
 *   node scripts/rebrand-source.mjs [dir]      (default: backend; absolute paths accepted)
 *
 * Every name it works with is read from its record rather than written here: the upstream
 * repository and website from the runtime's pin.json, Osade's repository from package.json.
 *
 * What changes:
 *   - The upstream project name, in every case, in text and in file and directory names. A word
 *     swap of equal length keeps every line where it was, so `backend/…:line` citations hold.
 *   - Links to where the project lives — the repository, its issue tracker and discussions, files
 *     in it, the website's home and documentation pages — point at Osade's repository. The agent
 *     guide the CLI tells agents to fetch points at the raw file in Osade's repository.
 *   - The release manifests keep only the pinned release.
 *
 * What does not, because changing it breaks something:
 *   - Release, download and update endpoints, and the release file names they serve. The code
 *     downloads real files at those addresses; renamed, the updater, installers and release
 *     tooling fail against them — found by running the tooling's tests before and after.
 *   - Upstream history links (pull requests, issues, commits), maintainer addresses and
 *     third-party repositories. Pointed at Osade, they would credit other people's work to Osade.
 *   - The repository the release tooling reads published releases from, which pairs with the
 *     kept release URLs, and the skills command that installs the upstream skill.
 *   - Two environment variables that would collide: HOME and SESSION would take names Osade
 *     itself sets, so a runtime built from this source would read Osade's own home directory as
 *     its own. They take an OSADE_RUNTIME_ prefix instead.
 *   - `OSADE-PIN.json`, the provenance record. Binary files, and build output.
 */

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const requested = process.argv[2] ?? 'backend';
const target = /^(?:[A-Za-z]:)?[\\/]/.test(requested) ? requested : join(ROOT, requested);

const SKIP_DIRS = new Set(['.git', 'target', 'node_modules', 'zig-pkg', 'zig-cache', '.zig-cache', 'zig-out']);
const SKIP_FILES = new Set(['OSADE-PIN.json']);
const MAX_BYTES = 20 * 1024 * 1024;

// ---- names, from their records ---------------------------------------------------------------

function runtimePin() {
  const dir = join(ROOT, 'vendor', 'runtime');
  const keys = readdirSync(dir).filter((key) => existsSync(join(dir, key, 'pin.json'))).sort();
  return JSON.parse(readFileSync(join(dir, keys[keys.length - 1], 'pin.json'), 'utf8'));
}

const pin = runtimePin();
const [OWNER, NAME] = new URL(pin.license.upstream_repository).pathname.split('/').filter(Boolean);
const WEBSITE_HOST = new URL(pin.license.upstream_website).host.toLowerCase();

const osadeRepository = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).repository;
const OSADE_SLUG = new URL(String(osadeRepository.url ?? osadeRepository).replace(/\.git$/, ''))
  .pathname.split('/')
  .filter(Boolean)
  .slice(0, 2)
  .join('/');
const OSADE_REPO = `https://github.com/${OSADE_SLUG}`;
const OSADE_RAW = `https://raw.githubusercontent.com/${OSADE_SLUG}/main`;
/** Where this tree sits inside Osade's repository. */
const IN_OSADE = 'backend';

const LOWER = NAME.toLowerCase();
const UPPER = LOWER.toUpperCase();
const TITLE = LOWER[0].toUpperCase() + LOWER.slice(1);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const W = escape(LOWER);
const SLUG = escape(`${OWNER}/${NAME}`);
const MENTIONS = new RegExp(W, 'i');

/** The file being rewritten, relative to the tree — some rules depend on where a mention sits. */
let currentFile = '';

function swap(text) {
  return text.split(UPPER).join('OSADE').split(TITLE).join('Osade').split(LOWER).join('osade');
}

// ---- addresses ------------------------------------------------------------------------------

const URL_PATTERN = /https?:\/\/[^\s"'`<>)\]]+/g;
/** Sentence punctuation and escaped newlines that trail a URL in prose and string literals. */
const TRAILING = /(?:\\n|[.,;:!?])+$/;
/** Hosts that are placeholders by definition, so a URL on one points nowhere real. */
const DUMMY_HOST = /^(example\.(com|org|net)|[\w-]+\.(example|test|invalid|localhost)|localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

function hostOf(url) {
  const authority = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/^[^@]*@/, '');
  return authority.replace(/:[^:\]]*$/, '').toLowerCase();
}

/**
 * What a URL mentioning the project becomes: itself (kept), an address in Osade's repository, or
 * null when it is on a dummy host and is renamed like any other text.
 */
function mapUrl(url) {
  const host = hostOf(url);
  if (DUMMY_HOST.test(host)) return null;
  const path = url.replace(/^https?:\/\/[^/?#]*/i, '');

  if (host === 'github.com' || host === 'www.github.com') {
    const repo = path.match(new RegExp(`^/${SLUG}(?=$|[/?#.])(.*)$`, 'i'));
    if (!repo) return url;
    const rest = repo[1];
    if (rest === '' || rest === '/' || rest === '.git') return OSADE_REPO;
    if (/^\/(?:issues|discussions|security)\/?$/i.test(rest) || /^\/issues\/new\b/i.test(rest)) {
      return OSADE_REPO + rest;
    }
    const file = rest.match(/^\/(blob|tree)\/[^/]+\/(.+)$/);
    if (file) return `${OSADE_REPO}/${file[1]}/main/${IN_OSADE}/${swap(file[2])}`;
    return url;
  }

  // A raw file from the repository: if this tree has that file, it is Osade's file now and the
  // link follows it. Otherwise it is a genuine upstream download, and kept.
  if (host === 'raw.githubusercontent.com') {
    const raw = path.match(new RegExp(`^/${SLUG}/[^/]+/(.+)$`, 'i'));
    // Either name: file contents are rewritten before paths are renamed, so on a first run the
    // file still has its upstream name, and on every later run it has Osade's.
    const present = raw && (existsSync(join(target, raw[1])) || existsSync(join(target, swap(raw[1]))));
    if (present) return `${OSADE_RAW}/${IN_OSADE}/${swap(raw[1])}`;
    return url;
  }

  if (host === WEBSITE_HOST || host.endsWith(`.${WEBSITE_HOST}`)) {
    // Deployment config for the website's own infrastructure (CORS origins and the like) names the
    // site as an origin; a repository page is not one.
    if (currentFile.startsWith('workers/')) return url;
    if (/^\/(?:latest|preview)\.json\b|^\/install\.(?:sh|ps1|cmd)\b|^\/api\/|^\/agent-detection\//i.test(path)) {
      return url;
    }
    if (/^\/agent-guide\.md\b/i.test(path)) return `${OSADE_RAW}/${IN_OSADE}/distribution/agent-guide.md`;
    return OSADE_REPO;
  }

  return url;
}

// ---- text -----------------------------------------------------------------------------------

/** Tokens held verbatim, first match wins. */
const KEPT = [
  // Release file names — the files the kept release URLs serve.
  new RegExp(`\\b${W}-(?:linux|macos|windows)-(?:x86_64|aarch64|arm64)(?:\\.zip|\\.exe)?(?![\\w-])`, 'g'),
  new RegExp(`\\b${W}-(?=\\{target\\})`, 'g'),
  new RegExp(`removeprefix\\('${W}-'\\)`, 'g'),
  // The executable inside the published Windows zip, and the name the installer and self-updater
  // give it on disk. Not cargo's own output, which follows the package name and is renamed.
  new RegExp(`(?<![\\\\/](?:release|debug)[\\\\/])\\b${W}\\.exe\\b`, 'g'),
  // Installs the upstream skill from the upstream repository.
  new RegExp(`skills add ${SLUG} --skill ${W}\\b`, 'g'),
  // Maintainer addresses, the domain in prose, third-party repositories.
  new RegExp(`[\\w.+-]+@(?:[\\w-]+\\.)*${escape(WEBSITE_HOST)}\\b`, 'gi'),
  new RegExp(`\\b(?:[a-z0-9-]+\\.)*${escape(WEBSITE_HOST)}\\b`, 'gi'),
  new RegExp(`\\b[\\w.-]+\\/${W}-plugin-examples\\b`, 'gi'),
];

/** Slugs naming where the project lives become Osade's; any other slug is the release source. */
const RELINKED_SLUGS = [
  [new RegExp(`github\\.repository == '${SLUG}'`, 'g'), `github.repository == '${OSADE_SLUG}'`],
  [new RegExp(`issues for \`${SLUG}\``, 'g'), `issues for \`${OSADE_SLUG}\``],
];
const KEPT_SLUG = new RegExp(`\\b${escape(OWNER)}\\b(?:\\/[\\w.-]+)?`, 'gi');

const COLLIDING = [
  [new RegExp(`\\b${UPPER}_HOME\\b`, 'g'), 'OSADE_RUNTIME_HOME'],
  [new RegExp(`\\b${UPPER}_SESSION\\b`, 'g'), 'OSADE_RUNTIME_SESSION'],
];

const stats = { files: 0, replaced: 0, kept: 0, relinked: 0, renamed: 0, trimmed: 0 };

function rebrandText(text) {
  // A private-use character marks a held token: it cannot occur in the source text, and unlike
  // NUL it is not a control character.
  const vault = [];
  const hold = (token) => `${vault.push(token) - 1}`;

  let out = text.replace(URL_PATTERN, (match) => {
    if (!MENTIONS.test(match)) return match;
    const tail = (match.match(TRAILING) ?? [''])[0];
    const url = tail ? match.slice(0, -tail.length) : match;
    const mapped = mapUrl(url);
    if (mapped === null) return match;
    if (mapped === url) stats.kept += 1;
    else stats.relinked += 1;
    return hold(mapped) + tail;
  });

  for (const pattern of KEPT) {
    out = out.replace(pattern, (match) => {
      stats.kept += 1;
      return hold(match);
    });
  }
  for (const [pattern, replacement] of RELINKED_SLUGS) {
    out = out.replace(pattern, () => {
      stats.relinked += 1;
      return hold(replacement);
    });
  }
  out = out.replace(KEPT_SLUG, (match) => {
    stats.kept += 1;
    return hold(match);
  });

  for (const [pattern, replacement] of COLLIDING) out = out.replace(pattern, replacement);
  out = swap(out);

  return out.replace(/(\d+)/g, (_, index) => vault[Number(index)]);
}

// ---- release manifests ----------------------------------------------------------------------

/** Keep only the entry for the release a manifest currently describes. */
const MANIFESTS = {
  'distribution/latest.json': (manifest) => ({ ...manifest, releases: only(manifest.releases, manifest.version) }),
  'distribution/preview.json': (manifest) => ({ ...manifest, builds: only(manifest.builds, manifest.build_id) }),
};

function only(entries, key) {
  if (!entries || typeof entries !== 'object' || !(key in entries)) return entries;
  return { [key]: entries[key] };
}

/** JSON as the release tooling writes it: two-space indent, non-ASCII escaped. */
function manifestJson(value) {
  const json = JSON.stringify(value, null, 2).replace(
    /[-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `${json}\n`;
}

// ---- walk -----------------------------------------------------------------------------------

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
    let text = before;

    currentFile = relative(target, path).replace(/\\/g, '/');
    const trim = MANIFESTS[currentFile];
    if (trim) {
      const trimmed = manifestJson(trim(JSON.parse(text)));
      if (trimmed !== text) stats.trimmed += 1;
      text = trimmed;
    }

    if (MENTIONS.test(text)) text = rebrandText(text);

    if (text !== before) {
      const count = (value) => (value.match(new RegExp(W, 'gi')) ?? []).length;
      stats.replaced += Math.max(0, count(before) - count(text));
      writeFileSync(path, text);
      stats.files += 1;
    }
  });

  // Deepest first, so renaming a directory never invalidates a path still to be renamed.
  for (const path of paths.sort((a, b) => b.length - a.length)) {
    const name = basename(path);
    if (!MENTIONS.test(name) || SKIP_FILES.has(name)) continue;
    renameSync(path, join(dirname(path), swap(name)));
    stats.renamed += 1;
  }

  process.stdout.write(
    `${relative(ROOT, target) || '.'}: ${stats.files} files changed (${stats.replaced} mentions removed, ` +
      `${stats.trimmed} manifests trimmed), ${stats.renamed} paths renamed, ` +
      `${stats.relinked} links pointed at Osade, ${stats.kept} addresses kept\n`,
  );
}

main();
