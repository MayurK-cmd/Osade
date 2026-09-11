import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { api, OsadeCliError } from './client.js';
import type { Io } from './cli.js';

/**
 * `osade .` — open the window on the repository you are standing in.
 *
 * The shape people already know from `code .`, and the reason it exists here: Osade's whole job
 * happens inside a repository, so the path from "I am in a repo" to "Osade is watching it" should
 * be one word. Before this, it was: find the app, launch it, find the repo in a list that may not
 * contain it yet.
 *
 * The daemon resolves the path to the repository *root*, so this works from any subdirectory.
 */

/**
 * Is this argument a path rather than a command?
 *
 * Deliberately narrow. `osade task` must never be read as "open the ./task directory", so a bare
 * word is only treated as a path when a directory of that name actually exists *and* it is not a
 * command name. `.`, `..`, anything with a slash, and anything absolute are unambiguous.
 */
export function looksLikePath(arg: string, commands: readonly string[]): boolean {
  if (arg === '.' || arg === '..') return true;
  if (arg.startsWith('~')) return true;
  if (/^[/\\]/.test(arg) || /^[A-Za-z]:[/\\]/.test(arg)) return true;
  if (arg.includes('/') || arg.includes('\\')) return true;
  if (commands.includes(arg)) return false;

  try {
    return statSync(resolve(arg)).isDirectory();
  } catch {
    return false;
  }
}

export async function openRepo(pathArg: string, io: Io): Promise<number> {
  const target = resolve(pathArg.startsWith('~') ? expandHome(pathArg) : pathArg);

  if (!existsSync(target)) {
    io.err(`${target} does not exist.\n`);
    return 2;
  }

  // The daemon owns the git question, so the answer is the same whether you came from here, the
  // window, or an agent driving the CLI (§17).
  const repo = await api.repoOpen(target);

  const where = repo.slug ?? repo.name;
  const tasks =
    repo.taskCount === 0
      ? 'no tasks yet'
      : `${repo.taskCount} ${repo.taskCount === 1 ? 'task' : 'tasks'}`;
  io.out(`${where} — ${tasks}\n`);

  const app = findApp();
  if (!app) {
    io.err(
      'could not find the Osade app to open.\n' +
        '  set OSADE_APP_BIN to its path, or run the desktop app yourself.\n' +
        `  the repository is registered either way: ${repo.path}\n`,
    );
    return 1;
  }

  // Detached, because the terminal that launched the window should not own it — closing the
  // shell must not take the app with it, exactly as §18.1 says of the daemon and the substrate.
  // `--repo=<path>` as one token: Electron rewrites the argv it hands a second instance, and a
  // two-token flag loses its value there.
  const child = spawn(app.command, [...app.args, `--repo=${repo.path}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  return 0;
}

function expandHome(path: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return home ? path.replace(/^~/, home) : path;
}

/**
 * Where the app is.
 *
 * `OSADE_APP_BIN` wins, then the packaged layout, then a source checkout. A checkout needs
 * electron and the built main, which is why it is last: it is the only one that can be
 * half-present.
 */
function findApp(): { command: string; args: string[] } | null {
  const explicit = process.env.OSADE_APP_BIN;
  if (explicit && existsSync(explicit)) return { command: explicit, args: [] };

  // Packaged: this file runs from <root>/resources/cli/bin.js, and the executable sits at the
  // root beside `resources`.
  const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const packagedRoot = resolve(here, '..', '..');
  for (const name of ['Osade.exe', 'Osade', 'osade']) {
    const candidate = join(packagedRoot, name);
    if (existsSync(candidate)) return { command: candidate, args: [] };
  }

  // A source checkout: <repo>/packages/cli/{src,dist} → repo root.
  const repoRoot = resolve(here, '..', '..', '..');
  const appDir = join(repoRoot, 'apps', 'desktop');
  if (!existsSync(join(appDir, 'dist', 'main', 'electron.js'))) return null;

  const electron = electronFromPackage(appDir);
  return electron ? { command: electron, args: [appDir] } : null;
}

/**
 * Electron's binary, through the package that declares it.
 *
 * `apps/desktop/node_modules/electron` rather than anything under `.pnpm`: the store's internal
 * layout is pnpm's business and has changed before, while the package's own node_modules entry is
 * the documented way to find it and is a symlink to whatever the store currently does.
 */
function electronFromPackage(appDir: string): string | null {
  const local = join(
    appDir,
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron',
  );
  return existsSync(local) ? local : null;
}

export { OsadeCliError };
