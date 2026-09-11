import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

/**
 * Spawn and adopt the Osade daemon — OSADE.md §18.1.
 *
 * The daemon owns tasks, gates, verification and the GitHub poller, and it must survive the
 * window closing exactly as herdr does: agents keep running, and half the system does not die
 * because someone closed a window.
 */

export function osadeRoot(): string {
  return process.env.OSADE_HOME ?? join(homedir(), '.osade');
}

function portFile(): string {
  return join(osadeRoot(), 'daemon.port');
}

async function health(port: number, timeoutMs = 1_500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // §2.1 — loopback only. There is no remote mode.
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function readPort(): number | null {
  try {
    const port = Number(readFileSync(portFile(), 'utf8').trim());
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * How to actually run the daemon — three things the first live launch got wrong, each of which
 * surfaced as the same useless symptom: "the daemon did not become healthy within 30s".
 *
 * **The daemon runs on Node, not on Electron's Node.** `process.execPath` under Electron is
 * `electron.exe`, whose Node has its own native ABI (`NODE_MODULE_VERSION` 130 for Electron 33,
 * against 127 for Node 22). `better-sqlite3` is compiled once, for Node — and it has to be,
 * because the daemon also runs standalone under the CLI and the test suite. Running it under
 * Electron would demand a second, ABI-matched build of the same module and two ways to get it
 * wrong. §2 already treats the daemon as an independent process that outlives the window; this
 * makes the runtime match that.
 *
 * **`ELECTRON_RUN_AS_NODE` is the fallback, not the plan.** If no Node is found, `electron.exe`
 * at least behaves as a Node runtime rather than booting a second, invisible Electron app — but
 * native modules will still be wrong, so the failure is loud when it comes.
 *
 * **A `.ts` entry is not executable.** In a source checkout the daemon is TypeScript and Node
 * answers `ERR_UNKNOWN_FILE_EXTENSION`. A packaged build ships JavaScript and is spawned
 * directly; a checkout goes through the same dev runner every doc and test already uses.
 */
export function daemonCommand(entry: string): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const node = nodeBinary();
  // Read at the use site, never snapshotted (§20.1).
  const env = { ...process.env };
  if (node.isElectron) env.ELECTRON_RUN_AS_NODE = '1';

  // Point better-sqlite3 straight at its addon, packaged or not.
  //
  // The daemon is a *bundle*, so the resolver better-sqlite3 would otherwise use (`bindings`,
  // which walks upward looking for a `node_modules/better-sqlite3/build`) is searching from the
  // wrong place and with the wrong assumptions. Packaged, the addon sits beside the bundle; in a
  // checkout it is still in the package's own node_modules.
  const addon = sqliteAddon(entry);
  if (addon) env.OSADE_SQLITE_BINDING = addon;

  const args = entry.endsWith('.ts')
    ? // `--` separates vite-node's own arguments from the script's; without it `start` is eaten.
      [viteNodeCli(entry), entry, '--', 'start']
    : [entry, 'start'];

  return { command: node.command, args, env };
}

/** The better-sqlite3 addon: beside a packaged bundle, or in the package's node_modules. */
function sqliteAddon(entry: string): string | null {
  const beside = join(dirname(entry), 'better_sqlite3.node');
  if (existsSync(beside)) return beside;

  // A checkout: <repo>/packages/daemon/dist/cli.js -> the package's own node_modules.
  const inPackage = join(
    dirname(dirname(entry)),
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );
  return existsSync(inPackage) ? inPackage : null;
}

/**
 * A real `node`, or Electron pretending.
 *
 * `OSADE_NODE_BIN` overrides the search, which is what a packaged build will set once it ships
 * its own runtime.
 */
export function nodeBinary(): { command: string; isElectron: boolean } {
  const name = process.platform === 'win32' ? 'node.exe' : 'node';

  const explicit = process.env.OSADE_NODE_BIN;
  if (explicit && existsSync(explicit)) return { command: explicit, isElectron: false };

  // The runtime Osade ships, which is the one a packaged app must use: a user's machine need not
  // have Node at all, and if it does, it may be a version this daemon does not run on.
  for (const vendored of vendoredNodePaths(name)) {
    if (existsSync(vendored)) return { command: vendored, isElectron: false };
  }

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return { command: candidate, isElectron: false };
  }

  return { command: process.execPath, isElectron: true };
}

/**
 * Where the shipped Node sits, packaged and in a checkout.
 *
 * `process.resourcesPath` exists only in a packaged Electron app, which is why it is read
 * defensively rather than assumed.
 */
function vendoredNodePaths(name: string): string[] {
  const target = `${process.platform}-${process.arch}`;
  const paths: string[] = [];

  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) paths.push(join(resources, 'node', name));

  // A source checkout: apps/desktop/dist/main → repo root.
  paths.push(join(__dirname, '../../../..', 'vendor', 'node', target, name));
  return paths;
}

/**
 * The dev runner's entry, found from the daemon entry rather than from `__dirname`.
 *
 * Resolving relative to this file would break the moment the main process is bundled; the
 * daemon entry is a real path inside the repo either way.
 */
function viteNodeCli(daemonEntry: string): string {
  let dir = dirname(daemonEntry);
  for (let up = 0; up < 8; up += 1) {
    const candidate = join(dir, 'node_modules', 'vite-node', 'dist', 'cli.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `cannot run the daemon from TypeScript: vite-node was not found above ${daemonEntry}. ` +
      `Build the daemon, or point OSADE_DAEMON_ENTRY at built JavaScript.`,
  );
}

/**
 * Where the daemon's output goes — `~/.osade/logs/daemon.log`.
 *
 * Not the parent's stdout. A packaged app on Windows is a GUI binary with **no console**, so
 * `stdio: 'inherit'` hands the child handles that are not there and the daemon dies on spawn
 * without saying anything — the app then waits out its 30-second health timeout and reports that
 * the daemon "did not become healthy", which is true and useless. That is what a packaged build
 * actually did.
 *
 * Inheriting was wrong even where it worked: a *detached* child holding the parent's stdout keeps
 * a terminal pipeline open long after the app exits, and §2.2 says everything Osade writes lives
 * under `~/.osade` anyway.
 */
function daemonLog(): number {
  const dir = join(osadeRoot(), 'logs');
  mkdirSync(dir, { recursive: true });
  return openSync(join(dir, 'daemon.log'), 'a');
}

export interface DaemonSupervisorOptions {
  /** Node entry for the daemon CLI. */
  entry: string;
  onInfo?: (message: string) => void;
}

export interface AdoptedDaemon {
  port: number;
  child: ChildProcess | null;
}

/**
 * Adopts a healthy daemon, or spawns one and waits for its ready handshake.
 *
 * The handshake is the port file plus a `/health` round trip — **never a fixed sleep** (§18.1).
 * A stale port file from a crashed daemon is removed rather than trusted.
 */
export async function adoptOrSpawnDaemon(
  options: DaemonSupervisorOptions,
): Promise<AdoptedDaemon> {
  const onInfo = options.onInfo ?? (() => {});

  const existing = readPort();
  if (existing != null && (await health(existing))) {
    onInfo(`adopted the running osade daemon on 127.0.0.1:${existing}`);
    return { port: existing, child: null };
  }
  if (existing != null && existsSync(portFile())) {
    rmSync(portFile(), { force: true });
  }

  const { command, args, env } = daemonCommand(options.entry);
  const log = daemonLog();
  const child = spawn(command, args, {
    env,
    stdio: ['ignore', log, log],
    detached: true,
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const port = readPort();
    if (port != null && (await health(port))) {
      onInfo(`spawned the osade daemon on 127.0.0.1:${port}`);
      return { port, child };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error('the osade daemon did not become healthy within 30s');
}
